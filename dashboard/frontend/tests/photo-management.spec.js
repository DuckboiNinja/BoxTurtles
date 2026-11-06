import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const photo = readFileSync(path.join(root, 'examples/generated/synthetic-turtle.jpg'));
const shortId = item => item.id.slice(0, 8).toUpperCase();

async function addPhoto(request, filename, candidates = 1) {
  const response = await request.post('/api/ingest/frame', { multipart: {
    file: { name: filename, mimeType: 'image/jpeg', buffer: photo },
    envelope: JSON.stringify({
      source: 'synthetic-photo-management-test', is_mock: true,
      detections: Array.from({ length: candidates }, (_, index) => ({ confidence: .86 + index * .01, bounding_box: [100 + index * 30, 100, 300 + index * 30, 300] })),
    }),
  } });
  expect(response.status()).toBe(201);
  return (await response.json()).data.detections;
}

async function review(request, item, action) {
  const response = await request.post(`/api/detections/${item.id}/${action}`);
  expect(response.status()).toBe(200);
}

async function statusOf(request, item) {
  return (await (await request.get(`/api/detections/${item.id}`)).json()).data.status;
}

test('selecting matching photos supports bulk confirmation, restoration, and rejection without changing other files', async ({ page, request }) => {
  const [first] = await addPhoto(request, 'manage-filtered-first.jpg');
  const [second] = await addPhoto(request, 'manage-filtered-second.jpg');
  const [outside] = await addPhoto(request, 'manage-outside-the-filter.jpg');
  await page.goto('/#pending');
  await page.getByRole('textbox', { name: 'Search detections' }).fill('manage-filtered-');
  await expect(page.locator('.detection-card')).toHaveCount(2);
  await page.getByRole('checkbox', { name: `Select detection ${shortId(first)}`, exact: true }).check();
  await page.getByRole('combobox', { name: 'File view', exact: true }).selectOption('list');
  await expect(page.getByRole('checkbox', { name: `Select detection ${shortId(first)}`, exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Select all matching detections', exact: true }).check();
  await page.getByRole('button', { name: 'Confirm selected', exact: true }).click();
  await expect(page.locator('.detection-card')).toHaveCount(0);
  expect(await statusOf(request, first)).toBe('verified');
  expect(await statusOf(request, second)).toBe('verified');
  expect(await statusOf(request, outside)).toBe('pending');

  await page.getByRole('navigation').getByRole('button', { name: 'Verified sightings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill('manage-filtered-');
  await page.getByRole('checkbox', { name: 'Select all matching detections', exact: true }).check();
  await page.getByRole('button', { name: 'Restore selected', exact: true }).click();
  await expect(page.locator('.detection-card')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: /Pending detections/ }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill('manage-filtered-');
  await page.getByRole('checkbox', { name: 'Select all matching detections', exact: true }).check();
  await page.getByRole('button', { name: 'Reject selected', exact: true }).click();
  await expect(page.locator('.detection-card')).toHaveCount(0);
  expect(await statusOf(request, first)).toBe('rejected');
  expect(await statusOf(request, second)).toBe('rejected');
  expect(await statusOf(request, outside)).toBe('pending');
});

test('deleting rejected photos requires explicit confirmation and preserves unrelated photos', async ({ page, request }) => {
  const [first] = await addPhoto(request, 'manage-delete-first.jpg');
  const [second] = await addPhoto(request, 'manage-delete-second.jpg');
  const [keep] = await addPhoto(request, 'manage-keep-verified.jpg');
  await review(request, first, 'reject');
  await review(request, second, 'reject');
  await review(request, keep, 'verify');
  await page.goto('/#pending');
  await page.getByRole('button', { name: /Rejected archive/ }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill('manage-delete-');
  await page.getByRole('checkbox', { name: 'Select all matching detections', exact: true }).check();
  await page.getByRole('button', { name: 'Delete selected photos', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete rejected photos', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(first.filename);
  await expect(confirmation).toContainText(second.filename);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect((await request.get(first.original_url)).status()).toBe(200);
  expect(await statusOf(request, first)).toBe('rejected');
  await page.getByRole('button', { name: 'Delete selected photos', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Delete photos', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.detection-card')).toHaveCount(0);
  for (const item of [first, second]) {
    expect((await request.get(`/api/detections/${item.id}`)).status()).toBe(404);
    expect((await request.get(item.original_url)).status()).toBe(404);
  }
  expect(await statusOf(request, keep)).toBe('verified');
  expect((await request.get(keep.original_url)).status()).toBe(200);
});

test('a rejected candidate cannot delete a photo shared with a pending candidate', async ({ page, request }) => {
  const [rejected, pending] = await addPhoto(request, 'manage-shared-photo.jpg', 2);
  await review(request, rejected, 'reject');
  await page.goto('/#pending');
  await page.getByRole('button', { name: /Rejected archive/ }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill(rejected.id);
  await page.getByRole('checkbox', { name: `Select detection ${shortId(rejected)}`, exact: true }).check();
  await expect(page.getByRole('button', { name: 'Delete selected photos', exact: true })).toBeDisabled();
  expect(await statusOf(request, pending)).toBe('pending');
  expect((await request.get(pending.original_url)).status()).toBe(200);
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `Select detection ${shortId(rejected)}`, exact: true })).not.toBeChecked();
});

test('a partial bulk review keeps the failed item selected so it can be retried', async ({ page, request }) => {
  const [saved] = await addPhoto(request, 'manage-partial-saved.jpg');
  const [failed] = await addPhoto(request, 'manage-partial-retry.jpg');
  const [outside] = await addPhoto(request, 'manage-untouched-by-partial-review.jpg');
  await page.goto('/#pending');
  await page.getByRole('textbox', { name: 'Search detections' }).fill('manage-partial-');
  await expect(page.locator('.detection-card')).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Select all matching detections', exact: true }).check();
  const failedRoute = `**/api/detections/${failed.id}/verify`;
  await page.route(failedRoute, route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'Review temporarily unavailable.' } }),
  }));
  await page.getByRole('button', { name: 'Confirm selected', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1 of 2 detections updated.');
  await expect(page.getByRole('alert')).toContainText('Review temporarily unavailable.');
  await expect(page.locator('.detection-card')).toHaveCount(1);
  await expect(page.getByRole('checkbox', { name: `Select detection ${shortId(failed)}`, exact: true })).toBeChecked();
  expect(await statusOf(request, saved)).toBe('verified');
  expect(await statusOf(request, failed)).toBe('pending');
  expect(await statusOf(request, outside)).toBe('pending');

  await page.unroute(failedRoute);
  await page.getByRole('button', { name: 'Confirm selected', exact: true }).click();
  await expect(page.locator('.detection-card')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Confirmed 1 detection.');
  expect(await statusOf(request, failed)).toBe('verified');
  expect(await statusOf(request, outside)).toBe('pending');
});

test('a stale deletion confirmation reports the conflict and keeps every selected photo', async ({ page, request }) => {
  const [changed] = await addPhoto(request, 'manage-stale-delete-changed.jpg');
  const [stillRejected] = await addPhoto(request, 'manage-stale-delete-unchanged.jpg');
  for (const item of [changed, stillRejected]) await review(request, item, 'reject');
  await page.goto('/#pending');
  await page.getByRole('button', { name: /Rejected archive/ }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill('manage-stale-delete-');
  await page.getByRole('checkbox', { name: 'Select all matching detections', exact: true }).check();
  await page.getByRole('button', { name: 'Delete selected photos', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete rejected photos', exact: true });
  await expect(confirmation).toContainText(changed.filename);
  await expect(confirmation).toContainText(stillRejected.filename);

  // Another review changes the photo after the user has opened the confirmation.
  await review(request, changed, 'reset');
  const deletionResponse = page.waitForResponse(response => response.url().endsWith('/api/images/delete-rejected') && response.request().method() === 'POST');
  await confirmation.getByRole('button', { name: 'Delete photos', exact: true }).click();
  expect((await deletionResponse).status()).toBe(409);
  await expect(confirmation.getByRole('alert')).toContainText('pending or verified detections');
  await expect(confirmation.getByRole('alert')).toContainText('no photos were deleted');
  for (const item of [changed, stillRejected]) {
    expect((await request.get(`/api/detections/${item.id}`)).status()).toBe(200);
    expect((await request.get(item.original_url)).status()).toBe(200);
  }
  expect(await statusOf(request, changed)).toBe('pending');
  expect(await statusOf(request, stillRejected)).toBe('rejected');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.detection-card')).toHaveCount(1);
});

test('an older running backend explains how to enable deletion and keeps the rejected photo', async ({ page, request }) => {
  const [item] = await addPhoto(request, 'manage-older-backend-delete.jpg');
  await review(request, item, 'reject');
  await page.goto('/#pending');
  await page.getByRole('button', { name: /Rejected archive/ }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill(item.id);
  await page.getByRole('checkbox', { name: `Select detection ${shortId(item)}`, exact: true }).check();
  await page.getByRole('button', { name: 'Delete selected photos', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete rejected photos', exact: true });
  await page.route('**/api/images/delete-rejected', route => route.fulfill({
    status: 404, contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'API route not found.', code: 404 } }),
  }));
  await confirmation.getByRole('button', { name: 'Delete photos', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toHaveText('The running backend does not support photo deletion yet. Restart the app with website.py, then refresh this page and try again.');
  expect(await statusOf(request, item)).toBe('rejected');
  expect((await request.get(item.original_url)).status()).toBe(200);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('.detection-card')).toHaveCount(1);
});

test('inspector navigation stays outside the photo and rapid clicks do not select underlying text', async ({ page, request }) => {
  for (const suffix of ['first', 'second', 'third']) await addPhoto(request, `manage-navigation-${suffix}.jpg`);
  await page.goto('/#pending');
  await page.getByRole('textbox', { name: 'Search detections' }).fill('manage-navigation-');
  await page.locator('.detection-card .image-button').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.inspector-stage button')).toHaveCount(0);
  for (const buttonName of ['Previous image', 'Next image']) {
    const bounds = await dialog.getByRole('button', { name: buttonName, exact: true }).boundingBox();
    const photoBounds = await dialog.locator('.inspector-stage').boundingBox();
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(photoBounds.y);
  }
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await dialog.getByRole('button', { name: 'Next image', exact: true }).dblclick();
  await expect(dialog.locator('.inspector-count')).toContainText('Image 3 of 3');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  await expect(dialog.locator('.detection-image img')).toHaveAttribute('draggable', 'false');
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/inspector-navigation-toolbar.png') });
});

test('sampling info buttons explain intervals and session limits with keyboard and mobile layouts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#live');
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('20');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    const intervalButton = page.getByRole('button', { name: 'About frame interval', exact: true });
    await intervalButton.focus();
    await page.keyboard.press('Enter');
    await expect(intervalButton).toHaveAttribute('aria-expanded', 'true');
    const intervalHelp = page.getByRole('note', { name: 'frame interval explained', exact: true });
    await expect(intervalHelp).toContainText('12 frames per minute');
    await page.keyboard.press('Escape');
    await expect(intervalHelp).toHaveCount(0);
    const limitButton = page.getByRole('button', { name: 'About maximum frames per session', exact: true });
    await limitButton.click();
    const limitHelp = page.getByRole('note', { name: 'maximum frames per session explained', exact: true });
    await expect(limitHelp).toContainText('60 sampled frames');
    await expect(limitHelp).toContainText('frames, not turtles');
    expect(await page.evaluate(() => document.documentElement.scrollWidth), theme).toBeLessThanOrEqual(390);
    expect(await limitHelp.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await limitButton.click();
    await expect(limitButton).toHaveAttribute('aria-expanded', 'false');
  }
});

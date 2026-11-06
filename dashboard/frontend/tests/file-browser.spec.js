import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const photo = readFileSync(path.join(root, 'examples/generated/synthetic-turtle.jpg'));
const shortId = item => item.id.slice(0, 8).toUpperCase();

async function addCandidates(request, prefix, confidences = [.72, .93, .83]) {
  const items = [];
  for (const [index, confidence] of confidences.entries()) {
    const response = await request.post('/api/ingest/frame', { multipart: {
      file: { name: `${prefix}-${index + 1}.jpg`, mimeType: 'image/jpeg', buffer: photo },
      envelope: JSON.stringify({ source: 'synthetic-browser-test', is_mock: true, detections: [{ confidence, bounding_box: [100, 100, 300, 300] }] }),
    } });
    expect(response.status()).toBe(201);
    items.push((await response.json()).data.detections[0]);
  }
  return items;
}

test('thumbnail sizes change preview width and the list preference survives reload and page changes', async ({ page, request }) => {
  const portraitResponse = await request.post('/api/ingest/frame', { multipart: {
    file: { name: 'browser-portrait-thumbnail.png', mimeType: 'image/png', buffer: readFileSync(path.join(root, 'frontend/tests/fixtures/portrait.png')) },
    envelope: JSON.stringify({ source: 'synthetic-browser-test', is_mock: true, detections: [{ confidence: .9, bounding_box: [20, 200, 200, 800] }] }),
  } });
  expect(portraitResponse.status()).toBe(201);
  const portrait = (await portraitResponse.json()).data.detections[0];
  await page.goto('/#pending');
  const view = page.getByRole('combobox', { name: 'File view', exact: true });
  await expect(view).toHaveValue('medium');
  const widths = [];
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  for (const mode of ['small', 'medium', 'large']) {
    await view.selectOption(mode);
    widths.push(await page.locator('.detection-card .image-button').first().evaluate(element => element.getBoundingClientRect().width));
    const geometry = await page.locator('.detection-card').filter({ hasText: `DET-${shortId(portrait)}` }).locator('.image-button').evaluate(element => {
      const preview = element.getBoundingClientRect(); const image = element.querySelector('.detection-image').getBoundingClientRect();
      return { previewWidth: preview.width, previewHeight: preview.height, imageWidth: image.width, imageHeight: image.height };
    });
    expect(geometry.previewHeight).toBeLessThan(geometry.previewWidth);
    expect(geometry.imageHeight).toBeLessThanOrEqual(geometry.previewHeight + 1);
    expect(geometry.imageWidth / geometry.imageHeight).toBeCloseTo(.24, 2);
    await page.screenshot({ path: path.join(root, `artifacts/files-${mode}-thumbnails.png`) });
  }
  expect(widths[0]).toBeLessThan(widths[1]);
  expect(widths[1]).toBeLessThan(widths[2]);
  await view.selectOption('list');
  await expect(page.locator('.detection-row').first()).toBeVisible();
  await expect(page.locator('.detection-row').first().locator('.row-filename')).not.toBeEmpty();
  await expect(page.locator('.detection-row').filter({ hasText: 'Synthetic demo' }).first()).toBeVisible();
  await page.screenshot({ path: path.join(root, 'artifacts/file-list-desktop.png') });
  await page.reload();
  await expect(view).toHaveValue('list');
  await page.getByRole('navigation').getByRole('button', { name: 'Verified sightings', exact: true }).click();
  await expect(view).toHaveValue('list');
  await expect(page.locator('.detection-row').first()).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: /Pending detections/ }).click();
  await page.getByRole('button', { name: /Rejected archive/ }).click();
  await expect(view).toHaveValue('list');
});

test('inspector arrows follow filtered sort order, preserve image controls, and keep a stable queue during polling', async ({ page, request }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const items = (await addCandidates(request, 'browser-navigation')).sort((a, b) => b.confidence - a.confidence);
  await page.goto('/#pending');
  await page.getByRole('textbox', { name: 'Search detections' }).fill('browser-navigation');
  await page.getByRole('combobox', { name: 'Sort detections' }).selectOption('confidence');
  await expect(page.locator('.detection-card')).toHaveCount(3);
  await page.locator('.detection-card .image-button').first().click();
  const dialog = page.getByRole('dialog');
  const previous = dialog.getByRole('button', { name: 'Previous image', exact: true });
  const next = dialog.getByRole('button', { name: 'Next image', exact: true });
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(`DET-${shortId(items[0])}`);
  await expect(previous).toBeDisabled();
  await expect(dialog.locator('.inspector-count')).toContainText('Image 1 of 3');
  await dialog.getByRole('button', { name: 'Object crop', exact: true }).click();
  await next.click();
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(`DET-${shortId(items[1])}`);
  await expect(dialog.locator('img')).toHaveAttribute('src', items[1].cropped_url);
  await dialog.getByRole('button', { name: 'Full frame', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Bounding box' }).uncheck();
  await page.keyboard.press('ArrowRight'); // Checkbox keyboard interaction must not change files.
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(`DET-${shortId(items[1])}`);
  await dialog.getByRole('button', { name: 'Full frame', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(`DET-${shortId(items[2])}`);
  await expect(dialog.locator('.detection-box')).toHaveCount(0);
  await expect(next).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('.inspector-count')).toContainText('Image 3 of 3');
  await previous.click();
  await dialog.getByRole('button', { name: 'Annotated', exact: true }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('img')).toHaveAttribute('src', items[0].annotated_url);
  await expect(previous).toBeDisabled();

  await addCandidates(request, 'browser-navigation-new', [.99]);
  await page.waitForResponse(response => response.url().includes('/api/detections?') && response.request().method() === 'GET');
  await expect(page.locator('.detection-card')).toHaveCount(4);
  await expect(dialog.locator('.inspector-count')).toContainText('Image 1 of 3');
  await next.click();
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(`DET-${shortId(items[1])}`);
  await dialog.getByRole('button', { name: 'Full frame', exact: true }).click();
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/inspector-navigation.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('list reviews target the opened file and a single match has disabled navigation', async ({ page, request }) => {
  const [first, second] = await addCandidates(request, 'browser-list-review', [.88, .91]);
  await page.goto('/#pending');
  await page.getByRole('combobox', { name: 'File view', exact: true }).selectOption('list');
  await page.getByRole('textbox', { name: 'Search detections' }).fill('browser-list-review');
  const row = item => page.locator('.detection-row').filter({ hasText: `DET-${shortId(item)}` });
  await row(first).getByRole('button', { name: /Inspect detection/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm turtle', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row(first)).toHaveCount(0);
  await row(second).getByRole('button', { name: /Reject detection/ }).click();
  await expect(row(second)).toHaveCount(0);
  await page.getByRole('button', { name: /Rejected archive/ }).click();
  await row(second).getByRole('button', { name: 'Return to pending', exact: true }).click();
  await expect(row(second)).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Verified sightings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill(first.id);
  await expect(page.getByRole('combobox', { name: 'File view', exact: true })).toHaveValue('list');
  await page.locator('.detection-row .image-button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.inspector-count')).toContainText('Image 1 of 1');
  await expect(dialog.getByRole('button', { name: 'Previous image', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Next image', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Return to pending', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm turtle', exact: true })).toBeEnabled();
  await expect(dialog).toContainText('Pending review');
  await page.keyboard.press('Escape');
  expect((await (await request.get(`/api/detections/${first.id}`)).json()).data.status).toBe('pending');
});

test('all file views and inspector arrows fit mobile with large text in both themes', async ({ page, request }) => {
  await addCandidates(request, 'browser-mobile-a-long-file-name-for-the-list-layout', [.87, .89]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#pending');
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('20');
  await page.getByRole('textbox', { name: 'Search detections' }).fill('browser-mobile-');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    for (const mode of ['small', 'medium', 'large', 'list']) {
      await page.getByRole('combobox', { name: 'File view', exact: true }).selectOption(mode);
      await expect(page.locator('.detection-card')).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${theme}/${mode}`).toBeLessThanOrEqual(390);
      const overflows = await page.locator('.detection-card').evaluateAll(cards => cards.filter(card => card.scrollWidth > card.clientWidth + 1).length);
      expect(overflows, `${theme}/${mode}: card overflow`).toBe(0);
    }
    await page.locator('.detection-row .image-button').first().click();
    const dialog = page.getByRole('dialog');
    const next = dialog.getByRole('button', { name: 'Next image', exact: true });
    await expect(next).toBeInViewport();
    await next.click();
    await expect(dialog.locator('.inspector-count')).toContainText('Image 2 of 2');
    const previous = dialog.getByRole('button', { name: 'Previous image', exact: true });
    await expect(previous).toBeInViewport();
    expect((await previous.boundingBox()).width).toBeGreaterThanOrEqual(44);
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: path.join(root, 'artifacts/file-list-mobile.png'), fullPage: true });
});

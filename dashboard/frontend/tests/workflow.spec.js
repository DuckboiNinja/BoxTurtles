import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sample = path.join(root, 'examples/generated/synthetic-turtle.jpg');
const video = path.join(root, 'examples/generated/synthetic-flight.avi');

test('dashboard and image inspector render without browser errors', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your survey, in focus/ })).toBeVisible();
  await expect(page.getByText('Demo workspace', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(8);
  await page.locator('.overview-actions').getByRole('button', { name: 'Upload media', exact: true }).click();
  await expect(page).toHaveURL(/#upload$/);
  await page.getByRole('button', { name: 'Asian Baddies home', exact: true }).click();
  await page.locator('.overview-actions').getByRole('button', { name: 'Review detections', exact: true }).click();
  await expect(page).toHaveURL(/#pending$/);
  await page.getByRole('button', { name: 'Asian Baddies home', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Turtle map', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Asian Baddies home', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect detection', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Bounding box' }).uncheck();
  await expect(page.locator('dialog .detection-box')).toHaveCount(0);
  await page.getByRole('button', { name: 'Object crop', exact: true }).click();
  await expect(page.locator('dialog img')).toHaveAttribute('src', /crop/);
  await page.getByRole('button', { name: 'Annotated', exact: true }).click();
  await expect(page.locator('dialog img')).toHaveAttribute('src', /annotated/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(root, 'artifacts/dashboard-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('confirm, undo, reject, and restore update the queue and record', async ({ page, request }) => {
  const item = (await (await request.get('/api/detections?status=pending')).json()).data[0];
  const id = item.id.slice(0, 8).toUpperCase();
  await page.goto('/#pending');
  const card = page.locator('.detection-card').filter({ hasText: `DET-${id}` });
  await card.getByRole('button', { name: 'Confirm turtle' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Verified sightings' }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill(id);
  const verified = page.locator('.detection-card').filter({ hasText: `S-${id}` });
  await expect(verified).toHaveCount(1);
  await verified.getByRole('button', { name: 'Return to pending' }).click();
  await expect(verified).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: /Pending detections/ }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill(id);
  await card.getByRole('button', { name: /Reject detection/ }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: /Rejected archive/ }).click();
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Return to pending' }).click();
  await expect(card).toHaveCount(0);
  const latest = await (await request.get(`/api/detections/${item.id}`)).json();
  expect(latest.data.status).toBe('pending');
  expect(latest.data.original_url).toBe(item.original_url);
});

test('settings retain unsaved edits across polling and persist on save', async ({ page, request }) => {
  await page.goto('/#settings');
  const slider = page.getByRole('slider', { name: 'Confidence threshold' });
  await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight');
  await expect(slider).toHaveValue('0.02');
  await page.waitForTimeout(5500);
  await expect(slider).toHaveValue('0.02');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('settings saved');
  const saved = (await (await request.get('/api/settings')).json()).data;
  expect(saved.confidence_threshold).toBe(0.02);
  await page.reload(); await expect(slider).toHaveValue('0.02');
  await request.put('/api/settings', { data: { ...saved, confidence_threshold: 0.5 } });
});

test('photograph upload preserves supplied coordinates and capture time', async ({ page, request }) => {
  await page.goto('/#upload');
  await page.getByLabel('Choose photos', { exact: true }).setInputFiles(sample);
  await page.getByLabel('Latitude', { exact: true }).fill('0');
  await page.getByLabel('Longitude', { exact: true }).fill('0');
  await page.getByLabel('Original capture time', { exact: true }).fill('2024-06-01T10:00');
  await page.getByLabel('Capture timezone offset', { exact: true }).fill('+00:00');
  await page.getByRole('button', { name: 'Process photographs', exact: true }).click();
  await expect(page.getByText('1 simulated candidates created.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Open pending detections' }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill('synthetic-turtle.jpg');
  await expect(page.locator('.detection-card')).toHaveCount(1);
  await expect(page.locator('.detection-card')).toContainText('0.00000, 0.00000');
  const item = (await (await request.get('/api/detections')).json()).data.find(x => x.filename === 'synthetic-turtle.jpg');
  expect(item.captured_at).toBe('2024-06-01T10:00:00+00:00');
  expect(item.is_mock).toBe(true);
});

test('recorded video processes selected frames with external telemetry', async ({ page }) => {
  await page.goto('/#upload');
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByLabel('Choose video', { exact: true }).setInputFiles(video);
  await page.getByLabel('Extract one frame every (seconds)', { exact: true }).fill('1');
  await page.getByLabel('Maximum selected frames', { exact: true }).fill('2');
  await page.getByLabel(/External telemetry/).setInputFiles(path.join(root, 'examples/telemetry.csv'));
  await page.getByRole('button', { name: 'Extract & process frames', exact: true }).click();
  const job = page.locator('.job').filter({ hasText: 'synthetic-flight.avi' });
  await expect(job).toContainText('completed', { timeout: 30000 });
  await expect(job).toContainText('2 / 2 frames · 2 candidates');
});

test('map excludes missing GPS and still works when tiles are unavailable', async ({ page, request }) => {
  const missing = (await (await request.get('/api/detections?status=pending')).json()).data.find(x => x.latitude == null);
  await request.post(`/api/detections/${missing.id}/verify`);
  const items = (await (await request.get('/api/sightings')).json()).data;
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  await page.goto('/#map');
  await expect(page.getByText(`${items.filter(x => x.latitude == null).length} without GPS`, { exact: false })).toBeVisible();
  await expect(page.getByText('Some sightings have no location', { exact: true })).toBeVisible();
  await expect(page.getByText(/Map tiles unavailable/)).toBeVisible();
  await expect(page.locator('.turtle-marker')).toHaveCount(items.filter(x => x.latitude != null).length);
  await page.getByRole('button', { name: 'Fit map to all sightings' }).click();
  await page.locator('.turtle-marker').first().click();
  await page.locator('.map-popup').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await request.post(`/api/detections/${missing.id}/reset`);
});

test('mobile navigation and all pages fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your survey, in focus/ })).toBeVisible();
  await expect(page.locator('.featured-info').getByRole('button', { name: 'Confirm turtle', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(root, 'artifacts/dashboard-mobile.png'), fullPage: true });
  for (const name of ['Pending detections', 'Verified sightings', 'Turtle map', 'Upload media', 'Live feed', 'Settings']) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation').getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByRole('navigation')).not.toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('readable text scale persists and supports every page on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your survey, in focus/ })).toBeVisible();
  const sizes = page.getByRole('combobox', { name: 'Text size', exact: true });
  await expect(sizes).toHaveValue('18');
  const normal = await page.locator('.page-heading p').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(normal).toBeGreaterThanOrEqual(15);
  await sizes.selectOption('20');
  await page.reload();
  await expect(sizes).toHaveValue('20');
  for (const route of ['dashboard', 'pending', 'sightings', 'map', 'upload', 'live', 'settings']) {
    await page.goto(`/#${route}`);
    await expect(page.locator('.page-heading h1')).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth,
      overflowing: [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => `${el.tagName}.${el.className}`).slice(0, 8) }));
    expect(dimensions.width, `${route}: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
  await sizes.selectOption('18');
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto('/#dashboard');
  await expect(page.getByRole('heading', { name: /Your survey, in focus/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(root, 'artifacts/dashboard-wide.png'), fullPage: true });
});

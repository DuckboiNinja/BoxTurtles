import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const photo = readFileSync(path.join(root, 'examples/generated/synthetic-turtle.jpg'));
const routes = ['dashboard', 'pending', 'sightings', 'map', 'upload', 'live', 'live-model', 'settings'];
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function contrastReadings(locator, textOnly = false) {
  return locator.evaluateAll((elements, textOnly) => {
    const rgba = value => { const channels = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0]; return [...channels.slice(0, 3), channels[3] ?? 1]; };
    const blend = (foreground, background) => foreground.slice(0, 3).map((channel, i) => channel * foreground[3] + background[i] * (1 - foreground[3]));
    const background = element => {
      if (!element) return [255, 255, 255];
      const color = rgba(getComputedStyle(element).backgroundColor);
      return color[3] >= 1 ? color.slice(0, 3) : blend(color, background(element.parentElement));
    };
    const luminance = color => color.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    return elements.filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility === 'visible' && (!textOnly || [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))).map(element => {
      const style = getComputedStyle(element); const bg = background(element); const foreground = blend(rgba(style.color), bg);
      const levels = [luminance(foreground), luminance(bg)].sort((a, b) => b - a);
      return { label: element.textContent.trim().slice(0, 70), className: element.className, color: style.color, background: bg, opacity: style.opacity, ratio: (levels[0] + .05) / (levels[1] + .05) };
    });
  }, textOnly);
}

test('light and dark appearance persist and buttons retain readable contrast on every page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.page-heading h1')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (const mode of ['dark', 'light']) {
    if (mode === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    for (const route of routes) {
      await page.goto(`/#${route}`);
      await expect(page.locator('.page-heading h1')).toBeVisible();
      const samples = await contrastReadings(page.locator('.button, .theme-toggle, .text-button, .segmented button, .nav-item, .tabs button'));
      for (const sample of samples) expect(sample.ratio, `${mode}/${route}: ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5);
      const copy = await contrastReadings(page.locator('main *, .sidebar *'), true);
      for (const sample of copy) expect(sample.ratio, `${mode}/${route} text: ${JSON.stringify(sample)}`).toBeGreaterThanOrEqual(4.5);
      if (route === 'pending') {
        const primary = page.locator('.detection-card .button.primary').first();
        await primary.hover();
        expect((await contrastReadings(primary))[0].ratio).toBeGreaterThanOrEqual(4.5);
      }
      if (route === 'upload') await expect(page.getByRole('button', { name: 'Process photographs' })).toBeDisabled();
    }
  }
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto('/#dashboard');
  await expect(page.locator('.page-heading h1')).toBeVisible();
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/dashboard-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.page-heading h1')).toBeVisible();
  await page.screenshot({ path: path.join(root, 'artifacts/dashboard-dark.png'), fullPage: true });
});

test('both themes work with extra-large text on mobile including the named inspector', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Text size', exact: true }).selectOption('20');
  for (const mode of ['dark', 'light']) {
    if (mode === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    for (const route of routes) {
      await page.goto(`/#${route}`);
      await expect(page.locator('.page-heading h1')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${mode}/${route}`).toBeLessThanOrEqual(391);
      await expect(page.locator('.theme-toggle')).toBeInViewport();
    }
  }
  await page.goto('/#pending');
  await page.locator('.detection-card .image-button').first().click();
  await expect(page.getByRole('dialog', { name: /DET-/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto('/#dashboard');
  await expect(page.locator('.page-heading h1')).toBeVisible();
  await page.screenshot({ path: path.join(root, 'artifacts/dashboard-light-mobile.png'), fullPage: true });
});

test('unknown camera timezone remains unknown and failed files survive partial uploads', async ({ page, request }) => {
  await page.goto('/#upload');
  await expect(page.getByLabel('Capture timezone offset', { exact: true })).toHaveValue('');
  await page.getByLabel('Choose photos', { exact: true }).setInputFiles([
    { name: 'unknown-zone-regression.jpg', mimeType: 'image/jpeg', buffer: photo },
    { name: 'broken-regression.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
  ]);
  await page.getByLabel('Original capture time', { exact: true }).fill('2024-06-01T10:00');
  await page.getByRole('button', { name: 'Process photographs', exact: true }).click();
  await expect(page.locator('.upload-results .success')).toHaveCount(1);
  await expect(page.locator('.upload-results .failure')).toHaveCount(1);
  await expect(page.locator('.selected-files')).toContainText('broken-regression.png');
  await expect(page.locator('.selected-files')).not.toContainText('unknown-zone-regression.jpg');
  const item = (await (await request.get('/api/detections')).json()).data.find(x => x.filename === 'unknown-zone-regression.jpg');
  expect(item.captured_at).toBe('2024-06-01T10:00:00');
  expect(item.metadata.warnings.some(x => x.includes('timezone is unknown'))).toBe(true);
});

test('a saved review stays successful when statistics refresh fails', async ({ page, request }) => {
  const item = (await (await request.get('/api/detections?status=pending')).json()).data.find(x => x.latitude != null);
  await page.goto('/#pending');
  await expect(page.locator('.page-heading h1')).toBeVisible();
  await page.route('**/api/stats', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Statistics temporarily unavailable.' } }) }));
  const card = page.locator('.detection-card').filter({ hasText: `DET-${item.id.slice(0, 8).toUpperCase()}` });
  await card.getByRole('button', { name: /Inspect detection/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm turtle' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Turtle confirmed');
  await expect(page.locator('.error-banner')).toContainText('Your review was saved');
  expect((await (await request.get(`/api/detections/${item.id}`)).json()).data.status).toBe('verified');
  await request.post(`/api/detections/${item.id}/reset`);
});

test('an older polling snapshot cannot overwrite a successfully saved setting', async ({ page, request }) => {
  await page.goto('/#settings');
  const slider = page.getByRole('slider', { name: 'Confidence threshold' });
  await expect(slider).toBeVisible();
  const before = (await (await request.get('/api/settings')).json()).data;
  let release; let held;
  const gate = new Promise(resolve => { release = resolve; });
  const blocked = new Promise(resolve => { held = resolve; });
  await page.route('**/api/jobs', async route => { held(); await gate; await route.continue(); });
  const oldSettings = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'GET');
  await Promise.all([blocked, oldSettings]);
  try {
    await slider.focus(); await slider.press('Home');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('settings saved');
    const jobsResponse = page.waitForResponse(response => response.url().endsWith('/api/jobs'));
    release(); await (await jobsResponse).finished(); await paint(page);
    await expect(slider).toHaveValue('0.01');
    expect((await (await request.get('/api/settings')).json()).data.confidence_threshold).toBe(0.01);
  } finally { release(); await request.put('/api/settings', { data: before }); }
});

test('portrait inspector bounding boxes use the image aspect ratio', async ({ page, request }) => {
  const result = await request.post('/api/ingest/frame', { multipart: {
    file: { name: 'portrait-regression.png', mimeType: 'image/png', buffer: readFileSync(path.join(root, 'frontend/tests/fixtures/portrait.png')) },
    envelope: JSON.stringify({ source: 'browser-test', is_mock: true, detections: [{ confidence: .9, bounding_box: [20, 200, 200, 800] }] }),
  } });
  expect(result.status()).toBe(201);
  const item = (await result.json()).data.detections[0];
  await page.goto('/#pending');
  await page.getByRole('textbox', { name: 'Search detections' }).fill(item.id);
  await page.locator('.detection-card .image-button').click();
  const geometry = await page.locator('dialog .detection-image').evaluate(element => {
    const frame = element.getBoundingClientRect(); const box = element.querySelector('.detection-box').getBoundingClientRect();
    return { ratio: frame.width / frame.height, boxLeft: (box.left - frame.left) / frame.width, boxTop: (box.top - frame.top) / frame.height };
  });
  expect(geometry.ratio).toBeCloseTo(.24, 2);
  expect(geometry.boxLeft).toBeCloseTo(20 / 240, 2);
  expect(geometry.boxTop).toBeCloseTo(.2, 2);
});

test('unrelated pending updates do not dismiss an open sighting popup', async ({ page, request }) => {
  await page.goto('/#map');
  await page.locator('.turtle-marker').first().click();
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await request.post('/api/upload', { multipart: { file: { name: 'map-preservation-regression.jpg', mimeType: 'image/jpeg', buffer: photo } } });
  const refresh = await page.waitForResponse(response => response.url().includes('/api/detections?') && response.request().method() === 'GET');
  await refresh.finished(); await paint(page);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
});

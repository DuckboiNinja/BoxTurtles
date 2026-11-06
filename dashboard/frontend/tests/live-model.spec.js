import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function mockCapture(page) {
  await page.addInitScript(() => {
    const state = { calls: 0, stopped: 0, tracks: [], snapshots: [], drawn: [], boxes: [], labels: [], requests: [] };
    window.__liveModelFixture = state;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, options = {}) => {
      if (String(input).includes('/api/inference/frame') && options.body instanceof FormData) {
        state.requests.push({ persist: options.body.get('persist_candidates'), envelope: JSON.parse(options.body.get('envelope')) });
      }
      return nativeFetch(input, options);
    };
    const nativeDraw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      const result = nativeDraw.apply(this, args);
      if (args[0] instanceof HTMLVideoElement) state.snapshots.push(Array.from(this.getImageData(10, 10, 1, 1).data));
      if (this.canvas.dataset.testid === 'live-model-canvas') state.drawn.push(Array.from(this.getImageData(10, 10, 1, 1).data));
      return result;
    };
    const nativeStroke = CanvasRenderingContext2D.prototype.strokeRect;
    CanvasRenderingContext2D.prototype.strokeRect = function (...args) {
      if (this.canvas.dataset.testid === 'live-model-canvas') state.boxes.push(args);
      return nativeStroke.apply(this, args);
    };
    const nativeText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (this.canvas.dataset.testid === 'live-model-canvas') state.labels.push(String(args[0]));
      return nativeText.apply(this, args);
    };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        state.calls++;
        const source = document.createElement('canvas');
        source.width = 640; source.height = 360;
        const context = source.getContext('2d');
        let frame = 0;
        const paint = () => {
          context.fillStyle = `rgb(${20 + frame++ % 100}, 55, 80)`;
          context.fillRect(0, 0, source.width, source.height);
          context.fillStyle = '#ffffff'; context.font = '18px sans-serif';
          context.fillText('Synthetic live model test feed', 20, 335);
        };
        paint();
        const timer = setInterval(paint, 40);
        const stream = source.captureStream(25);
        const track = stream.getVideoTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); state.stopped++; stop(); };
        state.tracks.push(track);
        return stream;
      },
    });
  });
}

function prediction(detections = [], extra = {}) {
  return {
    data: {
      width: 640, height: 360, detections, model_id: 'demo', model_name: 'Demo simulator',
      is_mock: true, inference_ms: 40, image_id: null, ...extra,
    },
  };
}

async function selectSource(page, route = 'live-model') {
  await page.goto(`/#${route}`);
  await page.getByRole('button', { name: 'Share scrcpy window', exact: true }).click();
  await expect(page.getByText('Window shared', { exact: true })).toBeVisible();
  await expect(page.getByText(/Receiving video/)).toBeVisible();
}

// Inspect FormData before native fetch; Chromium may omit streamed multipart bodies
// from Playwright's request.postDataBuffer() even when the upload succeeds.
const formValues = page => page.evaluate(() => window.__liveModelFixture.requests.at(-1));

test('live YOLO annotates the submitted snapshot and clears boxes on an empty result without saving', async ({ page }) => {
  await mockCapture(page);
  const requests = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/inference/frame', async route => {
    requests.push(await formValues(page));
    if (requests.length === 1) {
      await gate;
      await route.fulfill({ json: prediction([
        { class_name: 'turtle', confidence: 0.96, bounding_box: [60, 40, 200, 160] },
        { class_name: 'box turtle', confidence: 0.82, bounding_box: [260, 100, 410, 240] },
      ]) });
    } else await route.fulfill({ json: prediction() });
  });
  await selectSource(page);
  expect(requests).toHaveLength(0);
  await expect(page.locator('.live-inference-note')).toContainText(/demo|mock|simulat/i);
  await expect(page.getByLabel('Save candidate frames', { exact: true })).not.toBeChecked();
  await page.getByLabel('Maximum inference frames', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start live annotation', exact: true }).click();
  try {
    await expect.poll(() => requests.length).toBe(1);
    const snapshot = await page.evaluate(() => window.__liveModelFixture.snapshots.at(-1));
    await page.waitForTimeout(500); // The raw source changes while the first inference is held.
    release();
    const output = page.getByTestId('live-model-canvas');
    await expect(output).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__liveModelFixture.drawn.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__liveModelFixture.drawn.at(-1))).toEqual(snapshot);
    expect(await page.evaluate(() => window.__liveModelFixture.boxes)).toEqual(expect.arrayContaining([[60, 40, 140, 120], [260, 100, 150, 140]]));
    const labels = await page.evaluate(() => window.__liveModelFixture.labels);
    expect(labels.some(label => /turtle/i.test(label) && /96/.test(label))).toBe(true);
    await expect(page.getByRole('button', { name: 'Start live annotation', exact: true })).toBeEnabled();
    await expect(page.getByText('Annotation off', { exact: true })).toBeVisible();
    await expect(page.locator('.live-status-list > div').filter({ hasText: 'Actual annotation rate' }).locator('strong')).toHaveText(/^Measuring/);
    expect(requests[0].persist).toBe('false');
    expect(requests[0].envelope.source).toBe('scrcpy-window');
    expect(requests[0].envelope.metadata).toEqual({});
    expect(requests[0].envelope.frame_captured_at).toMatch(/T.*Z$/);
    mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts/live-yolo-desktop.png'), fullPage: true });
    const beforeEmpty = await page.evaluate(() => window.__liveModelFixture.boxes.length);
    await page.getByRole('button', { name: 'Start live annotation', exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(page.getByRole('button', { name: 'Start live annotation', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__liveModelFixture.boxes.length)).toBe(beforeEmpty);
    const pixels = await output.evaluate(canvas => {
      const context = canvas.getContext('2d');
      return [Array.from(context.getImageData(10, 10, 1, 1).data), Array.from(context.getImageData(60, 40, 1, 1).data)];
    });
    expect(pixels[1]).toEqual(pixels[0]); // No rectangle from the previous frame remains.
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__liveModelFixture.stopped)).toBe(1);
  } finally { release(); }
});

test('live annotation is sequential, obeys the frame cap, and explicitly opts into candidate saving', async ({ page }) => {
  await mockCapture(page);
  const requests = [];
  const starts = [];
  let active = 0; let maxActive = 0;
  await page.route('**/api/inference/frame', async route => {
    requests.push(await formValues(page)); starts.push(Date.now());
    active++; maxActive = Math.max(active, maxActive);
    await new Promise(resolve => setTimeout(resolve, 180));
    await route.fulfill({ json: prediction([{ id: `saved-${requests.length}`, class_name: 'turtle', confidence: 0.87, bounding_box: [60, 40, 200, 160], status: 'pending', review_method: null }], { image_id: `frame-${requests.length}` }) });
    active--;
  });
  await selectSource(page);
  await page.getByLabel('Target frames per second', { exact: true }).fill('2');
  await page.getByLabel('Maximum inference frames', { exact: true }).fill('3');
  await page.getByLabel('Save candidate frames', { exact: true }).check();
  await page.getByRole('button', { name: 'Start live annotation', exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  await expect(page.getByRole('button', { name: 'Start live annotation', exact: true })).toBeEnabled();
  expect(maxActive).toBe(1);
  expect(starts[1] - starts[0]).toBeGreaterThan(350);
  expect(starts[2] - starts[1]).toBeGreaterThan(350);
  expect(requests.every(item => item.persist === 'true')).toBe(true);
  const rate = Number.parseFloat(await page.locator('.live-status-list > div').filter({ hasText: 'Actual annotation rate' }).locator('strong').textContent());
  expect(rate).toBeGreaterThan(0);
  expect(rate).toBeLessThanOrEqual(2.3);
  await page.waitForTimeout(600);
  expect(requests).toHaveLength(3);
  await expect(page.locator('.live-status-list > div').filter({ hasText: 'Frames annotated' }).locator('strong')).toHaveText('3');
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
});

test('live pages retain sharing across modes and ignore a delayed annotation after stop or navigation', async ({ page }) => {
  await mockCapture(page);
  let release; let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/inference/frame', async route => {
    calls++; await gate;
    await route.fulfill({ json: prediction([{ class_name: 'turtle', confidence: 0.96, bounding_box: [60, 40, 200, 160] }]) });
  });
  await selectSource(page, 'live');
  await page.getByRole('navigation').getByRole('button', { name: 'Live YOLO', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start live annotation', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__liveModelFixture.calls)).toBe(1);
  expect(await page.evaluate(() => window.__liveModelFixture.stopped)).toBe(0);
  await page.getByRole('button', { name: 'Start live annotation', exact: true }).click();
  try {
    await expect.poll(() => calls).toBe(1);
    await page.waitForTimeout(400);
    expect(calls).toBe(1);
    await page.getByRole('button', { name: 'Stop live annotation', exact: true }).click();
    release();
    await expect(page.getByRole('button', { name: 'Start live annotation', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__liveModelFixture.boxes)).toHaveLength(0);
    await page.waitForTimeout(300);
    expect(calls).toBe(1);
    await page.getByRole('navigation').getByRole('button', { name: 'Live feed', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.__liveModelFixture.calls)).toBe(1);
    await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__liveModelFixture.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  } finally { release(); }
});

test('both live modes retain the same in-memory ingest token until the workspace is left', async ({ page }) => {
  await mockCapture(page);
  let expectedToken = 'test-shared-live-token';
  const authenticated = [];
  await page.route('**/api/ingest/frame', async route => {
    authenticated.push({ mode: 'source', token: route.request().headers()['x-ingest-token'] });
    if (authenticated.at(-1).token !== expectedToken) return route.fulfill({ status: 401, json: { error: { message: 'A valid X-Ingest-Token is required.' } } });
    await route.fulfill({ status: 201, json: { data: { image_id: 'synthetic-token-frame', detections: [], metadata: {} } } });
  });
  await page.route('**/api/inference/frame', async route => {
    authenticated.push({ mode: 'model', token: route.request().headers()['x-ingest-token'] });
    if (authenticated.at(-1).token !== expectedToken) return route.fulfill({ status: 401, json: { error: { message: 'A valid X-Ingest-Token is required.' } } });
    await route.fulfill({ json: prediction() });
  });
  await selectSource(page, 'live');
  await page.getByText('Advanced connection settings', { exact: true }).click();
  await page.getByLabel('Ingest token', { exact: true }).fill(expectedToken);
  await page.getByLabel('Maximum frames per session', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start detection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeEnabled();
  expect(authenticated).toEqual([{ mode: 'source', token: expectedToken }]);
  await page.getByRole('navigation').getByRole('button', { name: 'Live YOLO', exact: true }).click();
  await page.getByText('Advanced connection settings', { exact: true }).click();
  await expect(page.getByLabel('Ingest token', { exact: true })).toHaveValue(expectedToken);
  await page.getByLabel('Maximum inference frames', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start live annotation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start live annotation', exact: true })).toBeEnabled();
  expect(authenticated).toEqual([{ mode: 'source', token: expectedToken }, { mode: 'model', token: expectedToken }]);
  expectedToken = 'test-shared-live-token-updated';
  await page.getByLabel('Ingest token', { exact: true }).fill(expectedToken);
  await page.getByRole('navigation').getByRole('button', { name: 'Live feed', exact: true }).click();
  await expect(page.getByLabel('Ingest token', { exact: true })).toHaveValue(expectedToken);
  await page.getByRole('navigation').getByRole('button', { name: 'Live YOLO', exact: true }).click();
  await page.getByText('Advanced connection settings', { exact: true }).click();
  await expect(page.getByLabel('Ingest token', { exact: true })).toHaveValue(expectedToken);
  expect(await page.evaluate(() => window.__liveModelFixture.calls)).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('test-shared-live-token');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Live YOLO', exact: true }).click();
  await page.getByText('Advanced connection settings', { exact: true }).click();
  await expect(page.getByLabel('Ingest token', { exact: true })).toHaveValue('');
  await expect.poll(() => page.evaluate(() => window.__liveModelFixture.tracks.every(track => track.readyState === 'ended'))).toBe(true);
});

test('an older backend without live inference explains how to recover and stops annotation', async ({ page }) => {
  await mockCapture(page);
  let calls = 0;
  await page.route('**/api/inference/frame', route => {
    calls++;
    return route.fulfill({ status: 404, json: { error: { message: 'API route not found.' } } });
  });
  await selectSource(page);
  await page.getByRole('button', { name: 'Start live annotation', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('The running backend does not support Live YOLO yet. Restart the app with website.py');
  await expect(page.getByText('Annotation off', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start live annotation', exact: true })).toBeEnabled();
  await page.waitForTimeout(400);
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
});

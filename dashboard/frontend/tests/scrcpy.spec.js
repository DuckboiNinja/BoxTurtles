import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isFrame = response => response.url().endsWith('/api/ingest/frame') && response.request().method() === 'POST';

function frameEnvelope(request) {
  const multipart = request.postDataBuffer().toString('utf8');
  const marker = 'name="envelope"\r\n\r\n';
  const start = multipart.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  return JSON.parse(multipart.slice(start + marker.length).split('\r\n', 1)[0]);
}

// Exercise browser video/canvas decoding with a real MediaStream, while replacing
// the OS picker so CI never shares a user's actual desktop or survey data.
async function mockCapture(page, mode = 'normal') {
  await page.addInitScript(mode => {
    const state = { calls: 0, stopped: 0, tracks: [], options: [], resolvePicker: null };
    window.__fakeCapture = state;
    function stream() {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d');
      let frame = 0;
      const paint = () => {
        context.fillStyle = '#163c25'; context.fillRect(0, 0, 640, 360);
        context.fillStyle = '#b5e970'; context.fillRect(160 + (frame++ % 30), 100, 240, 130);
        context.fillStyle = '#ffffff'; context.font = '20px sans-serif';
        context.fillText('Synthetic scrcpy test feed', 20, 30);
      };
      paint();
      const timer = setInterval(paint, 80);
      const media = canvas.captureStream(12);
      const track = media.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); state.stopped++; stop(); };
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), displaySurface: 'window' });
      state.tracks.push(track);
      state.stream = media;
      return media;
    }
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: options => {
        state.calls++; state.options.push(options);
        if (mode === 'cancel-first' && state.calls === 1) return Promise.reject(new DOMException('Sharing canceled', 'NotAllowedError'));
        if (mode === 'deferred') return new Promise(resolve => { state.resolvePicker = () => resolve(stream()); });
        return Promise.resolve(stream());
      },
    });
  }, mode);
}

async function share(page) {
  await page.goto('/#live');
  await page.getByRole('button', { name: 'Share scrcpy window', exact: true }).click();
  await expect(page.getByText('Window shared', { exact: true })).toBeVisible();
  await expect(page.getByText(/Receiving video/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeEnabled();
}

test('scrcpy preview needs explicit detection and records browser capture time without GPS', async ({ page, request }) => {
  await mockCapture(page);
  const uploads = [];
  const envelopes = [];
  await page.route('**/api/ingest/frame', async route => {
    envelopes.push(frameEnvelope(route.request()));
    await route.continue();
  });
  page.on('request', request => { if (request.url().endsWith('/api/ingest/frame')) uploads.push(request); });
  await page.goto('/#live');
  await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeDisabled();
  await share(page);
  expect(uploads).toHaveLength(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByText(/Demo simulator/)).toBeVisible();
  await page.getByLabel('Frame interval (seconds)', { exact: true }).fill('1');
  await page.getByLabel('Maximum frames per session', { exact: true }).fill('2');
  const result = page.waitForResponse(isFrame);
  const sampleStarted = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: 'Start detection', exact: true }).click();
  const response = await result;
  const sampleFinished = await page.evaluate(() => Date.now());
  expect(response.status()).toBe(201);
  const envelope = envelopes[0];
  expect(envelope).toBeDefined();
  expect(envelope.source).toBe('scrcpy-window');
  expect(envelope.metadata).toEqual({});
  expect(envelope.frame_captured_at).toMatch(/T.*(?:Z|[+-]\d{2}:\d{2})$/);
  const sampledAt = Date.parse(envelope.frame_captured_at);
  expect(sampledAt).toBeGreaterThanOrEqual(sampleStarted);
  expect(sampledAt).toBeLessThanOrEqual(sampleFinished);
  const data = (await response.json()).data;
  expect(data.detections).toHaveLength(1);
  const item = (await (await request.get(`/api/detections/${data.detections[0].id}`)).json()).data;
  expect(item.source).toBe('scrcpy-window');
  expect(item.is_mock).toBe(true);
  expect(item.latitude).toBeNull(); expect(item.longitude).toBeNull();
  expect(Date.parse(item.captured_at)).toBe(sampledAt);
  expect(item.metadata.provenance.captured_at).toBe('browser frame capture');
  expect(item.width).toBe(640); expect(item.height).toBe(360);
  await expect(page.getByText('Frame limit reached. Start detection to begin another session.', { exact: true })).toBeVisible();
  await expect(page.getByText('Detection off', { exact: true })).toBeVisible();
  await expect(page.locator('.live-inference-note strong')).toContainText('Mock detections');
  await expect(page.locator('.live-status-list > div').filter({ hasText: 'Frames processed' }).locator('strong')).toHaveText('2');
  expect(uploads).toHaveLength(2);
  expect(envelopes).toHaveLength(2);
  mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/live-feed-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fakeCapture.stopped)).toBe(1);
  await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeDisabled();
  await page.getByRole('navigation').getByRole('button', { name: /Pending detections/ }).click();
  await page.getByRole('textbox', { name: 'Search detections' }).fill(item.id);
  await page.locator('.detection-card .image-button').click();
  const inspector = page.getByRole('dialog');
  await expect(inspector.getByText('Live frame captured', { exact: true })).toBeVisible();
  await expect(inspector).toContainText(/browser frame capture|browser clock/i);
});

test('JPEG encoding and upload delays do not replace the live frame capture timestamp', async ({ page, request }) => {
  await mockCapture(page);
  await page.addInitScript(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    window.__delayedEncoding = { startedAt: null, ready: false, release: null };
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      window.__delayedEncoding.startedAt = Date.now();
      return toBlob.call(this, blob => {
        window.__delayedEncoding.ready = true;
        window.__delayedEncoding.release = () => callback(blob);
      }, type, quality);
    };
  });
  let releaseUpload; let uploadArrived;
  const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
  const intercepted = new Promise(resolve => { uploadArrived = resolve; });
  let envelope;
  await page.route('**/api/ingest/frame', async route => {
    envelope = frameEnvelope(route.request());
    uploadArrived();
    await uploadGate;
    await route.continue();
  });
  await share(page);
  await page.getByLabel('Maximum frames per session', { exact: true }).fill('1');
  const sampleStarted = await page.evaluate(() => Date.now());
  const frameSaved = page.waitForResponse(isFrame);
  try {
    await page.getByRole('button', { name: 'Start detection', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__delayedEncoding.ready)).toBe(true);
    const encodingStarted = await page.evaluate(() => window.__delayedEncoding.startedAt);
    // A real delay separates the snapshot from JPEG availability without freezing timers.
    await page.waitForTimeout(1250);
    await page.evaluate(() => window.__delayedEncoding.release());
    await intercepted;
    const sampledAt = Date.parse(envelope.frame_captured_at);
    expect(sampledAt).toBeGreaterThanOrEqual(sampleStarted);
    expect(sampledAt).toBeLessThanOrEqual(encodingStarted);
    await page.waitForTimeout(600); // Also hold the HTTP upload after encoding has completed.
    releaseUpload();
    const response = await frameSaved;
    expect(response.status()).toBe(201);
    const itemId = (await response.json()).data.detections[0].id;
    const item = (await (await request.get(`/api/detections/${itemId}`)).json()).data;
    expect(Date.parse(item.captured_at)).toBe(sampledAt);
    expect(Date.parse(item.uploaded_at) - sampledAt).toBeGreaterThan(1500);
    expect(item.metadata.provenance.captured_at).toBe('browser frame capture');
    expect(item.latitude).toBeNull(); expect(item.longitude).toBeNull();
    await expect(page.getByText('Frame limit reached. Start detection to begin another session.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
  } finally { releaseUpload(); }
});

test('slow inference has one request at a time and stopping prevents later frames', async ({ page }) => {
  await mockCapture(page);
  await share(page);
  await page.getByLabel('Frame interval (seconds)', { exact: true }).fill('1');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/ingest/frame', async route => { calls++; await gate; await route.continue(); });
  await page.getByRole('button', { name: 'Start detection', exact: true }).click();
  try {
    await expect.poll(() => calls).toBe(1);
    await page.waitForTimeout(1250); // More than one configured interval while the response is held.
    expect(calls).toBe(1);
    await page.getByRole('button', { name: 'Stop detection', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Finishing frame…', exact: true })).toBeDisabled();
    const response = page.waitForResponse(isFrame);
    release(); await (await response).finished();
    await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeEnabled();
    await page.waitForTimeout(1250);
    expect(calls).toBe(1);
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__fakeCapture.stopped)).toBe(1);
  } finally { release(); }
});

test('browser stop-sharing and leaving the live page release the source', async ({ page }) => {
  await mockCapture(page);
  await share(page);
  await page.getByLabel('Frame interval (seconds)', { exact: true }).fill('1');
  let calls = 0;
  page.on('request', request => { if (request.url().endsWith('/api/ingest/frame')) calls++; });
  const response = page.waitForResponse(isFrame);
  await page.getByRole('button', { name: 'Start detection', exact: true }).click();
  await (await response).finished();
  await page.evaluate(() => window.__fakeCapture.tracks[0].dispatchEvent(new Event('ended')));
  await expect(page.getByRole('button', { name: 'Share scrcpy window', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeDisabled();
  await page.waitForTimeout(1250);
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Share scrcpy window', exact: true }).click();
  await expect(page.getByText(/Receiving video/)).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fakeCapture.tracks.every(track => track.readyState === 'ended'))).toBe(true);
});

test('canceled sharing and an ingestion error can be recovered without saving the token', async ({ page }) => {
  await mockCapture(page, 'cancel-first');
  await page.goto('/#live');
  await page.getByRole('button', { name: 'Share scrcpy window', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share scrcpy window', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Share scrcpy window', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeEnabled();
  await page.getByText('Advanced connection settings', { exact: true }).click();
  await page.getByLabel('Ingest token', { exact: true }).fill('test-session-token');
  let calls = 0;
  await page.route('**/api/ingest/frame', route => {
    calls++;
    expect(route.request().headers()['x-ingest-token']).toBe('test-session-token');
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'A valid X-Ingest-Token is required.' } }) });
  });
  await page.getByRole('button', { name: 'Start detection', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('A valid X-Ingest-Token is required.');
  await expect(page.getByText('Detection off', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start detection', exact: true })).toBeEnabled();
  expect(calls).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('test-session-token');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Live feed', exact: true }).click();
  await page.getByText('Advanced connection settings', { exact: true }).click();
  await expect(page.getByLabel('Ingest token', { exact: true })).toHaveValue('');
});

test('a capture chosen after navigation is immediately stopped', async ({ page }) => {
  await mockCapture(page, 'deferred');
  await page.goto('/#live');
  await page.getByRole('button', { name: 'Share scrcpy window', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose a window…', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.evaluate(() => window.__fakeCapture.resolvePicker());
  await expect.poll(() => page.evaluate(() => window.__fakeCapture.stopped)).toBe(1);
  await expect(page.locator('.page-heading h1')).toContainText('Settings');
});

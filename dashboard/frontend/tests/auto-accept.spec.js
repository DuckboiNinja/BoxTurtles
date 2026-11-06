import { test, expect } from '@playwright/test';

test('automatic acceptance is optional and saves its own confidence threshold', async ({ page, request }) => {
  const original = (await (await request.get('/api/settings')).json()).data;
  await request.put('/api/settings', { data: { ...original, confidence_threshold: 0.5, auto_accept_enabled: false, auto_accept_threshold: 0.95 } });
  try {
    await page.goto('/#settings');
    const enabled = page.getByRole('checkbox', { name: 'Automatically accept high-confidence turtles', exact: true });
    const threshold = page.getByLabel('Automatic acceptance threshold (%)', { exact: true });
    await expect(enabled).not.toBeChecked();
    await expect(threshold).toBeDisabled();
    await enabled.check();
    await threshold.fill('97.5');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Detection settings saved');
    const saved = (await (await request.get('/api/settings')).json()).data;
    expect(saved.auto_accept_enabled).toBe(true);
    expect(saved.auto_accept_threshold).toBe(0.975);
    expect(saved.confidence_threshold).toBe(0.5);
    await page.reload();
    await expect(enabled).toBeChecked();
    await expect(threshold).toHaveValue('97.5');
    await expect(page.locator('.auto-accept-settings')).toContainText('Demo, mock, and upstream results always await review.');
    await page.getByRole('navigation').getByRole('button', { name: /Pending detections/ }).click();
    await expect(page.locator('.auto-accept-summary')).toContainText('97.5% or higher');
  } finally {
    await request.put('/api/settings', { data: original });
  }
});

test('API-saved fractional acceptance thresholds remain editable without changing the policy', async ({ page, request }) => {
  const original = (await (await request.get('/api/settings')).json()).data;
  const preciseThreshold = 0.9755555;
  const configured = await request.put('/api/settings', { data: { ...original, confidence_threshold: 0.5, auto_accept_enabled: true, auto_accept_threshold: preciseThreshold } });
  expect(configured.ok()).toBe(true);
  try {
    await page.goto('/#settings');
    const threshold = page.getByLabel('Automatic acceptance threshold (%)', { exact: true });
    await expect(threshold).toHaveValue('97.55555');
    expect(await threshold.evaluate(input => input.validity.valid)).toBe(true);
    const confidence = page.getByRole('slider', { name: 'Confidence threshold', exact: true });
    await confidence.focus();
    await confidence.press('ArrowLeft');
    await expect(confidence).toHaveValue('0.49');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Detection settings saved');
    const saved = (await (await request.get('/api/settings')).json()).data;
    expect(saved.confidence_threshold).toBe(0.49);
    expect(saved.auto_accept_enabled).toBe(true);
    expect(saved.auto_accept_threshold).toBe(preciseThreshold);
    await threshold.fill('97.555551');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect.poll(async () => (await (await request.get('/api/settings')).json()).data.auto_accept_threshold).toBeCloseTo(0.97555551, 12);
  } finally {
    await request.put('/api/settings', { data: original });
  }
});

test('acceptance threshold cannot fall below the candidate confidence threshold', async ({ page, request }) => {
  const original = (await (await request.get('/api/settings')).json()).data;
  await request.put('/api/settings', { data: { ...original, confidence_threshold: 0.5, auto_accept_enabled: false, auto_accept_threshold: 0.95 } });
  try {
    await page.goto('/#settings');
    await page.getByRole('checkbox', { name: 'Automatically accept high-confidence turtles', exact: true }).check();
    await page.getByLabel('Automatic acceptance threshold (%)', { exact: true }).fill('95');
    const confidence = page.getByRole('slider', { name: 'Confidence threshold', exact: true });
    await confidence.focus(); await confidence.press('End'); await confidence.press('ArrowLeft');
    await expect(confidence).toHaveValue('0.99');
    let writes = 0;
    page.on('request', item => { if (item.method() === 'PUT' && item.url().endsWith('/api/settings')) writes++; });
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Automatic acceptance must be at least as high');
    expect(writes).toBe(0);
  } finally {
    await request.put('/api/settings', { data: original });
  }
});

test('automatically accepted sightings show their decision and threshold in the inspector and export', async ({ page, request }) => {
  const response = await request.get('/api/detections');
  const records = (await response.json()).data;
  const fixture = { ...records[0], id: 'autoaccept-browser-fixture', sighting_id: 'S-AUTOFIX', filename: 'auto-accept-fixture.jpg', latitude: null, longitude: null, captured_at: null, source: 'synthetic-browser-fixture', status: 'verified', confidence: 0.98, review_method: 'auto-confidence', auto_accept_threshold: 0.95, is_mock: false, is_demo: false, model_name: 'Synthetic test detector', reviewed_at: '2026-11-06T15:00:00Z' };
  // Only this browser sees the synthetic audit row. No database record is rewritten.
  await page.route('**/api/detections?*', route => route.fulfill({ json: { data: [fixture], total: 1, offset: 0, limit: 1000 } }));
  await page.goto('/#sightings');
  const card = page.locator('.detection-card').filter({ hasText: fixture.filename });
  await expect(card).toContainText('Automatically accepted');
  await expect(page.locator('.page-heading')).not.toContainText('confirmed by a human');
  await card.getByRole('button', { name: 'Inspect detection AUTOACCE', exact: true }).click();
  await expect(page.locator('dialog .auto-accept-audit')).toContainText('98% confidence with a 95% threshold');
  await expect(page.locator('dialog .detail-list')).toContainText('Acceptance methodAutomatically accepted; 95% threshold');
  await page.keyboard.press('Escape');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sightings', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString();
  expect(csv).toContain('review_method,auto_accept_threshold');
  expect(csv).toContain('"auto-confidence","0.95"');
});

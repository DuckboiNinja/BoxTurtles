export async function request(path, options = {}) {
  let response;
  try { response = await fetch(`/api${path}`, options); }
  catch { throw new Error('Cannot reach the local server. Start the FastAPI backend and try again.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (path === '/images/delete-rejected' && ((response.status === 404 && ['API route not found.', 'Not Found'].includes(body.error?.message || body.detail)) || response.status === 405)) {
      throw new Error('The running backend does not support photo deletion yet. Restart the app with website.py, then refresh this page and try again.');
    }
    const details = body.error?.details?.map(x => `${x.field}: ${x.message}`).join(' ');
    throw new Error(details || body.error?.message || `Request failed (${response.status}).`);
  }
  return body;
}

export const api = {
  async detections() {
    const records = [];
    let page;
    do {
      page = await request(`/detections?limit=1000&offset=${records.length}`);
      records.push(...page.data);
    } while (page.data.length && records.length < page.total);
    return records;
  },
  stats: () => request('/stats').then(x => x.data),
  settings: () => request('/settings').then(x => x.data),
  models: () => request('/models').then(x => x.data),
  jobs: () => request('/jobs').then(x => x.data),
  ingestFrame: (blob, token, sequence, frameCapturedAt) => {
    const body = new FormData();
    body.append('file', blob, `scrcpy-frame-${sequence}.jpg`);
    body.append('envelope', JSON.stringify({ source: 'scrcpy-window', metadata: {}, frame_captured_at: frameCapturedAt }));
    return request('/ingest/frame', { method: 'POST', body, ...(token ? { headers: { 'X-Ingest-Token': token } } : {}) }).then(x => x.data);
  },
  review: (id, action) => request(`/detections/${id}/${action}`, { method: 'POST' }).then(x => x.data),
  deleteRejectedPhotos: imageIds => request('/images/delete-rejected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_ids: imageIds }) }).then(x => x.data),
  saveSettings: data => request('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(x => x.data),
  addModel: data => request('/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(x => x.data),
  upload: (form, video) => request(video ? '/upload/video' : '/upload', { method: 'POST', body: form }).then(x => x.data),
};

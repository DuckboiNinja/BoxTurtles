export async function request(path, options = {}) {
  let response;
  try { response = await fetch(`/api${path}`, options); }
  catch { throw new Error('Cannot reach the local server. Start the FastAPI backend and try again.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
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
  liveSource: () => request('/live-source').then(x => x.data),
  saveLiveSource: data => request('/live-source', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(x => x.data),
  review: (id, action) => request(`/detections/${id}/${action}`, { method: 'POST' }).then(x => x.data),
  saveSettings: data => request('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(x => x.data),
  addModel: data => request('/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(x => x.data),
  upload: (form, video) => request(video ? '/upload/video' : '/upload', { method: 'POST', body: form }).then(x => x.data),
};

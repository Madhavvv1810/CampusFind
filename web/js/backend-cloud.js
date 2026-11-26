// The real backend: REST calls to API Gateway with the student's Cognito ID token.
// backend-demo.js implements the same methods in the browser, so views never branch on mode.
import { apiUrl, idToken, clearSession } from './auth.js';

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth) headers.authorization = `Bearer ${await idToken()}`;
  const response = await fetch(`${apiUrl()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && auth) {
    clearSession();
    throw new Error('Your session expired. Please sign in again.');
  }
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status}).`);
  return data;
}

const item = id => `/items/${encodeURIComponent(id)}`;
const chat = (itemId, claimId) => `${item(itemId)}/claims/${encodeURIComponent(claimId)}`;

export const cloudBackend = {
  mode: 'cloud',

  stats: () => request('/stats', { auth: false }).then(data => data.stats),
  listItems: cursor => request(`/items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  getItem: id => request(item(id)).then(data => data.item),

  /** Creates the post, uploads the photo straight to S3 with the presigned URL, then starts analysis. */
  async createPost({ fields, photo, visualHash }) {
    const payload = { ...fields, ...(photo ? { file: { contentType: photo.type, size: photo.size } } : {}), ...(visualHash ? { visualHash } : {}) };
    const { item: created, uploadUrl } = await request('/items', { method: 'POST', body: payload });
    if (photo) {
      const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': photo.type }, body: photo });
      if (!upload.ok) throw new Error('The photo upload failed. Open your post and choose "Retry photo".');
      await request(`${item(created.itemId)}/complete`, { method: 'POST', body: {} });
    }
    return created;
  },
  retryPhoto: id => request(`${item(id)}/complete`, { method: 'POST', body: {} }),
  editPost: (id, changes) => request(item(id), { method: 'PATCH', body: changes }).then(data => data.item),
  resolvePost: id => request(item(id), { method: 'PATCH', body: { status: 'RESOLVED' } }).then(data => data.item),
  deletePost: id => request(item(id), { method: 'DELETE' }),
  matches: id => request(`${item(id)}/matches`).then(data => data.matches),
  report: (id, reason) => request(`${item(id)}/report`, { method: 'POST', body: { reason } }),

  inbox: () => request('/inbox'),
  chatsFor: id => request(`${item(id)}/claims`).then(data => data.claims),
  startChat: (id, body) => request(`${item(id)}/claims`, { method: 'POST', body }).then(data => data.claim),
  sendMessage: (itemId, claimId, text) => request(`${chat(itemId, claimId)}/messages`, { method: 'POST', body: { text } }).then(data => data.claim),
  markSeen: (itemId, claimId) => request(chat(itemId, claimId), { method: 'PATCH', body: { seen: true } }),
  decide: (itemId, claimId, status, reply) => request(chat(itemId, claimId), { method: 'PATCH', body: { status, reply } }).then(data => data.claim),

  adminOverview: () => request('/admin/overview'),
  adminPosts: () => request('/admin/posts'),
  adminUsers: () => request('/admin/users'),
  setUserStatus: (username, enabled) => request(`/admin/users/${encodeURIComponent(username)}/status`, { method: 'POST', body: { enabled } }),
  moderate: (id, action) => request(`/admin${item(id)}/moderate`, { method: 'POST', body: { action } }),
};

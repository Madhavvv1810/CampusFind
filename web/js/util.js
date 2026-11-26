// Small DOM, formatting and storage helpers shared by every view.

export const $ = selector => document.querySelector(selector);
export const $$ = selector => [...document.querySelectorAll(selector)];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Every piece of user content goes through this before it touches innerHTML. */
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);

export const CATEGORIES = {
  electronics: 'Electronics', keys: 'Keys', 'id-cards': 'ID card', bags: 'Bag',
  clothing: 'Clothing', bottles: 'Bottle', books: 'Book or notebook', other: 'Other',
};
export const CATEGORY_ICONS = {
  electronics: '🎧', keys: '🔑', 'id-cards': '🪪', bags: '🎒', clothing: '🧥', bottles: '🧴', books: '📓', other: '📦',
};
export const HANDOVER_POINTS = {
  'with-finder': 'With the finder', security: 'Security office', library: 'Library help desk', department: 'Department office',
};
export const REPORT_REASONS = {
  spam: 'Spam or advertising', inappropriate: 'Inappropriate photo or text', duplicate: 'Duplicate post', scam: 'Looks like a scam', other: 'Something else',
};

export const categoryIcon = category => CATEGORY_ICONS[category] ?? '📦';
export const itemTitle = item => item.title || `${item.itemType === 'FOUND' ? 'Found' : 'Lost'} ${CATEGORIES[item.category] ?? 'item'}`;

export function dateText(value, options = { dateStyle: 'medium' }) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, options) : '';
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a date. */
export function timeAgo(value, now = Date.now()) {
  const seconds = Math.round((now - Date.parse(value)) / 1000);
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} day${seconds < 2 * 86_400 ? '' : 's'} ago`;
  return dateText(value);
}

export function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3600);
}

export function readJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

/** localStorage that never throws (private windows, blocked storage). */
export const storage = {
  get(key, fallback = null) { try { return readJson(localStorage.getItem(key), fallback); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Disables a button while an async action runs, and shows a busy label. */
export async function busy(button, label, action) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try { return await action(); } finally { button.disabled = false; button.textContent = original; }
}

/** Opens a <dialog> unless it is already open. */
export function openDialog(selector) {
  const dialog = $(selector);
  if (!dialog.open) dialog.showModal();
  return dialog;
}

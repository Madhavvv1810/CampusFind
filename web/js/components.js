// Markup shared by several pages: post cards, photos, status chips, stats tiles, empty states.
import { state } from './state.js';
import { escapeHTML, categoryIcon, itemTitle, timeAgo, CATEGORIES, HANDOVER_POINTS } from './util.js';

export const STATUS_LABELS = {
  AWAITING_UPLOAD: 'Photo pending', PROCESSING: 'Checking photo', PROCESSING_FAILED: 'Photo needs retry',
  ACTIVE: 'Open', RESOLVED: 'Returned', HIDDEN: 'Under review',
};

/** A resolved lost post reads as "found": it is back with its owner. */
export const shownType = item => (item.status === 'RESOLVED' && item.itemType === 'LOST' ? 'FOUND' : item.itemType);
export const itemPath = item => `/item/${encodeURIComponent(item.itemId)}`;

export function photoMarkup(item, size = '') {
  return item.imageUrl
    ? `<img src="${escapeHTML(item.imageUrl)}" alt="Photo of ${escapeHTML(itemTitle(item))}" loading="lazy" decoding="async">`
    : `<div class="photo-placeholder ${size}"><span>${categoryIcon(item.category)}</span><small>${item.hasPhoto ? 'Photo loading' : 'No photo'}</small></div>`;
}

export function tags(item) {
  const type = shownType(item);
  const status = item.status ?? 'ACTIVE';
  return `<span class="type-tag ${type === 'LOST' ? 'tag-lost' : 'tag-found'}">${type === 'LOST' ? 'Lost' : 'Found'}</span>
    <span class="status-tag status-${status.toLowerCase()}">${STATUS_LABELS[status] ?? escapeHTML(status)}</span>`;
}

function chatInfo(item) {
  const threads = state.threads.filter(thread => thread.itemId === item.itemId);
  return { count: threads.length, unread: threads.some(thread => thread.unread), mine: threads.some(thread => thread.role === 'claimant' && thread.status !== 'DECLINED') };
}

function quickAction(item) {
  if (item.status !== 'ACTIVE') return '';
  const chats = chatInfo(item);
  if (item.mine) {
    return chats.count
      ? `<a class="text-action${chats.unread ? ' has-unread' : ''}" href="/messages?item=${encodeURIComponent(item.itemId)}">💬 ${chats.count}${chats.unread ? ' new' : ''}</a>`
      : `<a class="text-action" href="${itemPath(item)}#matches">Find matches</a>`;
  }
  const label = chats.mine ? 'Open chat' : item.itemType === 'FOUND' ? 'This is mine' : 'I found this';
  return `<button class="text-action" data-contact="${escapeHTML(item.itemId)}">${label}</button>`;
}

export function card(item) {
  return `<article class="item-card">
    <a class="card-link" href="${itemPath(item)}" aria-label="${escapeHTML(itemTitle(item))}"></a>
    <div class="item-photo">${photoMarkup(item)}${tags(item)}${item.seed ? '<span class="sample-tag" title="Sample data for the demonstration">Sample</span>' : ''}</div>
    <div class="item-body">
      <div class="card-meta"><span class="category-label">${categoryIcon(item.category)} ${escapeHTML(CATEGORIES[item.category] ?? 'Other')}</span><span>${escapeHTML(timeAgo(item.createdAt))}</span></div>
      <h3>${escapeHTML(itemTitle(item))}</h3>
      <p class="item-description">${escapeHTML(item.description || 'No extra details.')}</p>
      <div class="location-line"><span>📍</span>${escapeHTML(item.location || 'Place not given')}</div>
      ${item.handover ? `<div class="location-line kept-at"><span>🏷️</span>Kept at: ${escapeHTML(HANDOVER_POINTS[item.handover] ?? item.handover)}</div>` : ''}
      <div class="card-footer"><span class="owner-label">${item.mine ? 'Posted by you' : `Posted by ${escapeHTML(item.ownerLabel ?? 'a student')}`}</span><div class="card-buttons">${quickAction(item)}</div></div>
    </div>
  </article>`;
}

export const grid = items => `<div class="feed-grid">${items.map(card).join('')}</div>`;

export function emptyState(icon, title, text, action = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
}

export const formatHours = hours => (hours === null || hours === undefined ? '—' : hours < 24 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} d`);
export const statTile = (value, label) => `<div class="stat"><b>${escapeHTML(value)}</b><span>${label}</span></div>`;

export const pageHead = (eyebrow, title, intro = '', actions = '') => `<header class="page-head">
  <div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${intro ? `<p class="page-intro">${intro}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;

export const loading = text => `<div class="loading-line"><span class="spinner"></span> ${text}</div>`;

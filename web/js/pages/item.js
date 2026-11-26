// Item page: photo, details, owner tools, inline match suggestions, contact, share and report.
import { state, findItem, upsertItem, isCloud, on } from '../state.js';
import { escapeHTML, CATEGORIES, HANDOVER_POINTS, REPORT_REASONS, categoryIcon, itemTitle, dateText, timeAgo, toast } from '../util.js';
import { photoMarkup, tags, emptyState, loading, itemPath } from '../components.js';
import { openContact } from '../chat.js';
import { navigate } from '../router.js';

const STATUS_NOTES = {
  RESOLVED: '✅ This item is back with its owner.',
  HIDDEN: '⚠️ Hidden from the board while a moderator reviews reports.',
  PROCESSING: '⏳ The photo is being checked. This takes a few seconds.',
  PROCESSING_FAILED: '⚠️ The photo could not be processed. Use “Retry photo”.',
  AWAITING_UPLOAD: '⚠️ The photo did not finish uploading. Use “Retry photo”.',
};
const row = (label, value) => (value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '');

function actions(item) {
  const chats = state.threads.filter(thread => thread.itemId === item.itemId);
  if (item.mine) {
    return [
      item.status === 'ACTIVE' && `<a class="button button-dark" href="/messages?item=${encodeURIComponent(item.itemId)}">💬 Messages (${chats.length})</a>`,
      item.status === 'ACTIVE' && `<button class="button button-light" data-do="resolve">${item.itemType === 'LOST' ? 'I got it back' : 'Owner collected it'}</button>`,
      ['AWAITING_UPLOAD', 'PROCESSING_FAILED'].includes(item.status) && '<button class="button button-dark" data-do="retry">Retry photo</button>',
      !['RESOLVED', 'REMOVED'].includes(item.status) && `<a class="button button-light" href="${itemPath(item)}/edit">Edit</a>`,
      '<button class="button button-danger" data-do="delete">Delete</button>',
    ].filter(Boolean).join('');
  }
  if (item.status !== 'ACTIVE') return '';
  const chatting = chats.some(thread => thread.role === 'claimant' && thread.status !== 'DECLINED');
  return `<button class="button button-dark" data-do="contact">${chatting ? 'Open your chat' : item.itemType === 'FOUND' ? 'This is mine — contact finder' : 'I found this — contact owner'}</button>`;
}

function detailMarkup(item) {
  return `
    <a class="back-link" href="/browse">← Back to the board</a>
    <article class="item-page">
      <div class="item-media">${photoMarkup(item, 'large')}</div>
      <div class="item-info">
        <div class="detail-head">${tags(item)}${item.seed ? '<span class="chip">Sample</span>' : ''}</div>
        <h1>${escapeHTML(itemTitle(item))}</h1>
        ${STATUS_NOTES[item.status] ? `<p class="status-note">${STATUS_NOTES[item.status]}</p>` : ''}
        ${item.description ? `<p class="detail-description">${escapeHTML(item.description)}</p>` : ''}
        <dl class="detail-grid">
          ${row('Category', `${categoryIcon(item.category)} ${escapeHTML(CATEGORIES[item.category] ?? 'Other')}`)}
          ${row(item.itemType === 'LOST' ? 'Lost at' : 'Found at', escapeHTML(item.location))}
          ${row(item.itemType === 'LOST' ? 'Lost on' : 'Found on', item.occurredOn ? escapeHTML(dateText(item.occurredOn)) : '')}
          ${row('Kept at', item.handover ? escapeHTML(HANDOVER_POINTS[item.handover] ?? item.handover) : '')}
          ${row('Posted', `${item.mine ? 'by you' : `by ${escapeHTML(item.ownerLabel ?? 'a student')}`} · ${escapeHTML(timeAgo(item.createdAt))}${item.editedAt ? ' · edited' : ''}`)}
          ${row('Photo labels', (item.labels ?? []).map(label => `<span class="chip">${escapeHTML(label)}</span>`).join(' '))}
        </dl>
        <div class="detail-actions">${actions(item)}<button class="button button-light" data-do="share">Share</button></div>
        ${!item.mine && isCloud() && item.status === 'ACTIVE' ? `
          <details class="report-box"><summary>Report this post</summary>
            <label>Reason<select id="report-reason">${Object.entries(REPORT_REASONS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
            <button class="button button-light" data-do="report">Send report</button></details>` : ''}
      </div>
    </article>
    ${item.mine && item.status === 'ACTIVE' ? `<section class="section" id="matches"><div class="section-head"><div><div class="eyebrow">SUGGESTED MATCHES</div>
      <h2>${item.itemType === 'FOUND' ? 'People who may have lost this' : 'Found items that may be yours'}</h2></div></div><div id="match-list">${loading('Comparing with the campus board…')}</div></section>` : ''}`;
}

function matchMarkup(source, match) {
  const reasons = [match.sameType && `Same item: ${match.sameType}`, match.sameColour && `Same colour: ${match.sameColour}`, match.colourConflict && 'Different colour', match.photoSimilarity, match.sharedLabels?.length ? `Shared labels: ${match.sharedLabels.join(', ')}` : '', match.sameCategory && 'Same category',
    match.titleOverlap >= 0.2 && 'Similar description', match.sameLocation && 'Same place'].filter(Boolean).map(escapeHTML).join(' · ');
  return `<article class="match-card">
    <div class="match-photo-pair"><div class="compare-thumb">${photoMarkup(source)}<small>Yours</small></div><span class="compare-arrow">↔</span>
      <div class="compare-thumb">${photoMarkup(match)}<small>Possible match</small></div></div>
    <div class="match-details">
      <div class="match-topline"><span>${match.itemType} · ${escapeHTML(CATEGORIES[match.category] ?? 'Other')}</span><b class="score" style="--score:${match.score}">${match.score}% match</b></div>
      <h3><a href="${itemPath(match)}">${escapeHTML(itemTitle(match))}</a></h3>
      <p>📍 ${escapeHTML(match.location || 'Place not given')} · ${escapeHTML(match.ownerLabel ?? 'a student')} · ${escapeHTML(timeAgo(match.createdAt))}</p>
      <small>${reasons || 'Possible match based on the details given'}</small>
      <button class="button button-light claim-action" type="button" data-contact="${escapeHTML(match.itemId)}">${source.itemType === 'FOUND' ? 'I found this — contact them' : 'This is mine — contact finder'}</button>
    </div></article>`;
}

async function loadMatches(view, item) {
  const target = view.querySelector('#match-list');
  if (!target) return;
  try {
    const matches = await state.backend.matches(item.itemId);
    target.innerHTML = matches.length ? matches.map(match => matchMarkup(item, match)).join('')
      : emptyState('🕵️', 'No likely match yet', 'Every new post is compared with yours as it arrives. Check back later.');
  } catch (error) {
    target.innerHTML = `<p class="form-error">${escapeHTML(error.message)}</p>`;
  }
}

export async function renderItem(view, { id }) {
  let item = findItem(id);
  view.innerHTML = item ? detailMarkup(item) : loading('Loading post…');
  try {
    item = await state.backend.getItem(id);
    upsertItem(item);
    view.innerHTML = detailMarkup(item);
  } catch (error) {
    if (!item) { view.innerHTML = emptyState('🔍', 'Post not found', escapeHTML(error.message), '<a class="button button-dark" href="/browse">Browse the board</a>'); return; }
  }
  document.title = `${itemTitle(item)} · CampusFind`;
  loadMatches(view, item);
  if (location.hash === '#matches') view.querySelector('#matches')?.scrollIntoView({ behavior: 'smooth' });

  view.addEventListener('click', async event => {
    const contact = event.target.closest('[data-contact]');
    if (contact) { openContact(contact.dataset.contact, item.itemId); return; }
    const button = event.target.closest('[data-do]');
    if (!button) return;
    try {
      switch (button.dataset.do) {
        case 'contact': openContact(item.itemId); break;
        case 'retry': await state.backend.retryPhoto(item.itemId); toast('Photo check restarted.'); break;
        case 'resolve':
          if (!confirm('Mark this post as returned? It will stop getting messages.')) return;
          item = await state.backend.resolvePost(item.itemId);
          upsertItem(item);
          view.innerHTML = detailMarkup(item);
          toast('Marked as returned. Great news!');
          break;
        case 'delete':
          if (!confirm('Delete this post? Its photo is deleted too. This cannot be undone.')) return;
          await state.backend.deletePost(item.itemId);
          upsertItem({ ...item, status: 'REMOVED' });
          toast('Post deleted.');
          navigate('/profile');
          break;
        case 'share': {
          const url = `${location.origin}${itemPath(item)}`;
          if (navigator.share) await navigator.share({ title: `CampusFind: ${itemTitle(item)}`, url }).catch(() => {});
          else { await navigator.clipboard.writeText(url); toast('Link copied.'); }
          break;
        }
        case 'report': {
          const result = await state.backend.report(item.itemId, view.querySelector('#report-reason').value);
          toast(result.message ?? 'Thanks. A moderator will review this post.');
          view.querySelector('.report-box').open = false;
          break;
        }
        default:
      }
    } catch (error) {
      toast(error.message);
    }
  });
  // Re-render while the photo is processing so the page updates by itself.
  return on('items', () => {
    const fresh = findItem(id);
    if (fresh && fresh.status !== item.status) { item = fresh; view.innerHTML = detailMarkup(item); loadMatches(view, item); }
  });
}

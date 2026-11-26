// Profile: who you are, your numbers, your posts and your latest conversations.
import { state, on, isCloud } from '../state.js';
import { escapeHTML, timeAgo } from '../util.js';
import { grid, emptyState, statTile } from '../components.js';
import { signOut } from '../auth.js';

const TABS = [
  ['open', 'Open', item => ['ACTIVE', 'PROCESSING', 'AWAITING_UPLOAD', 'PROCESSING_FAILED', 'HIDDEN'].includes(item.status)],
  ['returned', 'Returned', item => item.status === 'RESOLVED'],
  ['all', 'All posts', () => true],
];

const initials = name => String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?';

function recentChats() {
  const threads = state.threads.slice(0, 5);
  if (!threads.length) return '<p class="muted">No conversations yet. Use “This is mine” on a found item to start one.</p>';
  return threads.map(thread => {
    const last = thread.messages.at(-1) ?? {};
    return `<a class="activity-row${thread.unread ? ' unread' : ''}" href="/messages/${encodeURIComponent(thread.itemId)}/${encodeURIComponent(thread.claimId)}">
      <b>${escapeHTML(thread.itemTitle || 'Item')}</b><span>${escapeHTML(last.text ?? '').slice(0, 70)}</span><small>${escapeHTML(timeAgo(thread.updatedAt))}${thread.unread ? ' · new' : ''}</small></a>`;
  }).join('');
}

export function renderMine(view, params, query) {
  let tab = query.get('tab') ?? 'open';
  const user = state.user ?? { name: 'Sample student', email: 'demo board · stored in this browser' };
  view.innerHTML = `
    <section class="profile-card">
      <div class="avatar" aria-hidden="true">${escapeHTML(initials(user.name))}</div>
      <div class="profile-who">
        <h1>${escapeHTML(user.name)}</h1>
        <p class="muted">${escapeHTML(user.email ?? '')}</p>
        <div class="badges">${isCloud() ? '<span class="chip">✓ Verified college account</span>' : '<span class="chip">Sample profile</span>'}${user.isAdmin ? '<span class="chip chip-strong">🛡 Moderator</span>' : ''}</div>
      </div>
      <div class="profile-actions">
        <a class="button button-outline" href="/report/lost">＋ Report lost</a>
        <a class="button button-dark" href="/report/found">＋ Report found</a>
        ${user.isAdmin ? '<a class="button button-light" href="/admin">Admin dashboard</a>' : ''}
        ${isCloud() ? '<button class="button button-light" id="profile-signout">Sign out</button>' : ''}
      </div>
    </section>
    <section class="stats-strip" id="my-stats"></section>
    <div class="profile-grid">
      <section>
        <div class="section-head"><h2>Your posts</h2><div class="filters" id="my-tabs">${TABS.map(([key, label]) => `<button class="filter${key === tab ? ' active' : ''}" data-tab="${key}">${label}</button>`).join('')}</div></div>
        <div id="my-feed"></div>
      </section>
      <aside class="panel">
        <h3>Recent conversations</h3><div id="my-chats"></div>
        <a class="link-button" href="/messages">Open messages →</a>
        <h3 class="spaced">Good to know</h3>
        <ul class="checklist"><li>Posts expire after 90 days.</li><li>Others see your name as “${escapeHTML(String(user.name).split(' ')[0])} ${escapeHTML((String(user.name).split(' ')[1] ?? '')[0] ?? '')}.”, never your email.</li><li>Mark a post returned as soon as you get it back.</li></ul>
      </aside>
    </div>`;

  const draw = () => {
    const mine = state.items.filter(item => item.mine);
    view.querySelector('#my-stats').innerHTML = [
      statTile(mine.filter(TABS[0][2]).length, 'open posts'),
      statTile(mine.filter(TABS[1][2]).length, 'returned'),
      statTile(state.threads.filter(thread => thread.role === 'owner').length, 'people contacted you'),
      statTile(state.threads.filter(thread => thread.role === 'claimant').length, 'chats you started'),
    ].join('');
    const shown = mine.filter(TABS.find(([key]) => key === tab)[2]);
    view.querySelector('#my-feed').innerHTML = shown.length ? grid(shown)
      : emptyState('📭', tab === 'returned' ? 'Nothing returned yet' : 'No posts here', 'Report something you lost or found and it will show up here.', '<a class="button button-dark" href="/report/lost">Report an item</a>');
    view.querySelector('#my-chats').innerHTML = recentChats();
  };
  view.querySelector('#my-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    tab = button.dataset.tab;
    view.querySelectorAll('[data-tab]').forEach(other => other.classList.toggle('active', other === button));
    history.replaceState(null, '', `/profile?tab=${tab}`);
    draw();
  });
  view.querySelector('#profile-signout')?.addEventListener('click', signOut);
  draw();
  const offItems = on('items', draw);
  const offThreads = on('threads', draw);
  return () => { offItems(); offThreads(); };
}

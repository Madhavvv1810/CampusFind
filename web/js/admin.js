// Admin portal (Cognito group "admins"): overview, every post, every user, and reported posts.
import { state, reloadItems } from './state.js';
import { escapeHTML, itemTitle, timeAgo, dateText, toast, REPORT_REASONS, CATEGORIES } from './util.js';
import { photoMarkup, statTile, formatHours, emptyState, loading, itemPath, STATUS_LABELS } from './components.js';
import { signIn } from './auth.js';

const TABS = [['overview', '📊 Overview'], ['posts', '📦 All posts'], ['users', '👥 Users'], ['reports', '🚩 Reports']];

function dailyChart(daily) {
  const width = 560;
  const height = 150;
  const max = Math.max(1, ...daily.map(day => day.posts));
  const barWidth = width / daily.length;
  const bars = daily.map((day, index) => {
    const x = index * barWidth + 4;
    const scale = value => (value / max) * (height - 26);
    const label = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return `<g><title>${label}: ${day.posts} posts, ${day.returned} returned</title>
      <rect x="${x}" y="${height - 20 - scale(day.posts)}" width="${barWidth - 8}" height="${scale(day.posts)}" rx="3" class="bar-posts"/>
      <rect x="${x}" y="${height - 20 - scale(day.returned)}" width="${barWidth - 8}" height="${scale(day.returned)}" rx="3" class="bar-returned"/>
      ${index % 2 === 0 ? `<text x="${x + (barWidth - 8) / 2}" y="${height - 5}" text-anchor="middle">${label}</text>` : ''}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="daily-chart" role="img" aria-label="Posts and returns per day">${bars}</svg>
    <div class="chart-legend"><span class="key-posts"></span>Posts <span class="key-returned"></span>Returned</div>`;
}

function categoryBars(rows) {
  const max = Math.max(1, ...rows.map(row => row.lost + row.found));
  return rows.map(row => `<div class="cat-row"><span>${escapeHTML(row.label)}</span>
    <div class="cat-bar"><i class="lost" style="width:${(row.lost / max) * 100}%"></i><i class="found" style="width:${(row.found / max) * 100}%"></i></div><b>${row.lost + row.found}</b></div>`).join('')
    || '<p class="muted">No posts yet.</p>';
}

const views = {
  async overview() {
    const { stats, flagged, stuck } = await state.backend.adminOverview();
    return `<div class="stats-grid">${[statTile(stats.total, 'posts (90 days)'), statTile(stats.openLost, 'open lost'), statTile(stats.openFound, 'open found'),
      statTile(stats.returned, 'returned'), statTile(`${stats.returnRate}%`, 'return rate'), statTile(formatHours(stats.medianHoursToReturn), 'median time to return')].join('')}</div>
      ${flagged.length ? `<p class="status-note">🚩 ${flagged.length} reported post${flagged.length === 1 ? '' : 's'} waiting in <b>Reports</b>.</p>` : ''}
      ${stuck ? `<p class="status-note">⚠️ ${stuck} photo${stuck === 1 ? '' : 's'} failed processing.</p>` : ''}
      <div class="admin-grid"><section class="panel"><h3>Last 14 days</h3>${dailyChart(stats.daily)}</section>
        <section class="panel"><h3>By category</h3><div class="cat-legend"><span class="lost"></span>Lost <span class="found"></span>Found</div>${categoryBars(stats.byCategory)}</section></div>`;
  },

  async posts() {
    const { posts } = await state.backend.adminPosts();
    return `<div class="admin-toolbar"><input type="search" id="admin-filter" placeholder="Search title, place or student…" aria-label="Search posts">
      <select id="admin-status"><option value="">All statuses</option>${Object.entries(STATUS_LABELS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select>
      <span class="muted">${posts.length} posts</span></div>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th></th><th>Post</th><th>Type</th><th>Category</th><th>Place</th><th>By</th><th>Status</th><th>Posted</th><th></th></tr></thead><tbody>
      ${posts.map(post => `<tr data-search="${escapeHTML(`${itemTitle(post)} ${post.location ?? ''} ${post.ownerLabel ?? ''}`.toLowerCase())}" data-status="${post.status}">
        <td class="thumb">${photoMarkup(post)}</td><td><a href="${itemPath(post)}">${escapeHTML(itemTitle(post))}</a>${post.reportCount ? ` <span class="chip">🚩 ${post.reportCount}</span>` : ''}</td>
        <td>${post.itemType === 'LOST' ? 'Lost' : 'Found'}</td><td>${escapeHTML(CATEGORIES[post.category] ?? '—')}</td><td>${escapeHTML(post.location || '—')}</td>
        <td>${escapeHTML(post.ownerLabel ?? '')}</td><td><span class="status-tag status-${String(post.status).toLowerCase()}">${STATUS_LABELS[post.status] ?? post.status}</span></td>
        <td>${escapeHTML(timeAgo(post.createdAt))}</td>
        <td class="row-actions">${post.status === 'HIDDEN' ? `<button class="button button-light" data-moderate="restore" data-id="${escapeHTML(post.itemId)}">Restore</button>` : ''}
          <button class="button button-danger" data-moderate="remove" data-id="${escapeHTML(post.itemId)}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>`;
  },

  async users() {
    const { users } = await state.backend.adminUsers();
    return `<div class="admin-toolbar"><input type="search" id="admin-filter" placeholder="Search name or email…" aria-label="Search users"><span class="muted">${users.length} accounts</span></div>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Posts</th><th>Joined</th><th>Account</th><th></th></tr></thead><tbody>
      ${users.map(account => `<tr data-search="${escapeHTML(`${account.name} ${account.email}`.toLowerCase())}">
        <td><b>${escapeHTML(account.name || '—')}</b>${account.isYou ? ' <span class="chip">you</span>' : ''}</td><td>${escapeHTML(account.email)}</td>
        <td>${account.isAdmin ? '<span class="chip chip-strong">Admin</span>' : 'Student'}</td><td>${account.posts}</td>
        <td>${escapeHTML(dateText(account.createdAt))}</td>
        <td>${account.enabled ? '<span class="chip">Active</span>' : '<span class="chip chip-danger">Blocked</span>'}${account.status !== 'CONFIRMED' ? ` <small class="muted">${escapeHTML(account.status.replace(/_/g, ' ').toLowerCase())}</small>` : ''}</td>
        <td class="row-actions">${account.isYou ? '' : `<button class="button ${account.enabled ? 'button-danger' : 'button-light'}" data-user="${escapeHTML(account.username)}" data-enable="${!account.enabled}">${account.enabled ? 'Block' : 'Unblock'}</button>`}</td></tr>`).join('')}
      </tbody></table></div>`;
  },

  async reports() {
    const { flagged } = await state.backend.adminOverview();
    if (!flagged.length) return emptyState('🛡️', 'Nothing to review', 'Reported posts show up here. Three reports hide a post automatically.');
    return flagged.map(item => `<article class="flag-row">
      <div class="flag-photo">${photoMarkup(item)}</div>
      <div class="flag-main"><a href="${itemPath(item)}"><b>${escapeHTML(itemTitle(item))}</b></a>
        <small>${item.status === 'HIDDEN' ? '🚫 Hidden' : '⚠️ Reported'} · ${item.reportCount} report${item.reportCount === 1 ? '' : 's'} · ${escapeHTML([...new Set(item.reportReasons ?? [])].map(reason => REPORT_REASONS[reason] ?? reason).join(', '))} · by ${escapeHTML(item.ownerLabel)} ${escapeHTML(timeAgo(item.createdAt))}</small></div>
      <div class="flag-actions"><button class="button button-light" data-moderate="restore" data-id="${escapeHTML(item.itemId)}">Keep</button>
        <button class="button button-danger" data-moderate="remove" data-id="${escapeHTML(item.itemId)}">Delete</button></div></article>`).join('');
  },
};

export async function renderAdmin(view, params, query) {
  if (!state.user) {
    view.innerHTML = `<section class="admin-login"><div class="avatar" aria-hidden="true">🛡</div><h1>Admin portal</h1>
      <p class="muted">Sign in with your admin email and password to manage posts, users and reports.</p>
      <button class="button button-dark" id="admin-signin">Admin sign in</button></section>`;
    view.querySelector('#admin-signin').addEventListener('click', () => signIn());
    return;
  }
  if (!state.user.isAdmin) {
    view.innerHTML = emptyState('🔒', 'Admins only', 'This account is not an admin. Sign out and sign in with an admin account.', '<a class="button button-dark" href="/">Home</a>');
    return;
  }
  let tab = TABS.some(([key]) => key === query.get('tab')) ? query.get('tab') : 'overview';
  view.innerHTML = `<section class="admin-hero"><div><div class="eyebrow">ADMIN PORTAL</div><h1>Campus control centre</h1>
      <p>Signed in as <b>${escapeHTML(state.user.name)}</b> · full access to posts, users and reports.</p></div></section>
    <nav class="admin-tabs" role="tablist">${TABS.map(([key, label]) => `<button role="tab" data-tab="${key}" class="${key === tab ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <div id="admin-body"></div>`;

  const draw = async () => {
    view.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    view.querySelector('#admin-body').innerHTML = loading('Loading…');
    try { view.querySelector('#admin-body').innerHTML = await views[tab](); } catch (error) { view.querySelector('#admin-body').innerHTML = `<p class="form-error">${escapeHTML(error.message)}</p>`; }
  };
  view.addEventListener('click', async event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) { tab = tabButton.dataset.tab; history.replaceState(null, '', `/admin?tab=${tab}`); draw(); return; }
    const moderate = event.target.closest('[data-moderate]');
    const block = event.target.closest('[data-user]');
    try {
      if (moderate) {
        if (moderate.dataset.moderate === 'remove' && !confirm('Delete this post for everyone? Its photo is deleted too.')) return;
        toast((await state.backend.moderate(moderate.dataset.id, moderate.dataset.moderate)).message);
        await Promise.all([draw(), reloadItems()]);
      }
      if (block) {
        const enable = block.dataset.enable === 'true';
        if (!enable && !confirm('Block this account? They will not be able to sign in.')) return;
        toast((await state.backend.setUserStatus(block.dataset.user, enable)).message);
        await draw();
      }
    } catch (error) { toast(error.message); }
  });
  view.addEventListener('input', event => {
    if (!event.target.matches('#admin-filter, #admin-status')) return;
    const words = (view.querySelector('#admin-filter')?.value ?? '').toLowerCase().trim();
    const status = view.querySelector('#admin-status')?.value ?? '';
    view.querySelectorAll('tbody tr').forEach(row => { row.hidden = (words && !row.dataset.search.includes(words)) || (status && row.dataset.status !== status); });
  });
  view.addEventListener('change', event => { if (event.target.matches('#admin-status')) event.target.dispatchEvent(new Event('input', { bubbles: true })); });
  await draw();
}

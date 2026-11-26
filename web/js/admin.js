// Admin page (Cognito group "admins"): campus dashboard and the reported-posts queue.
import { state, reloadItems } from './state.js';
import { escapeHTML, itemTitle, timeAgo, toast, REPORT_REASONS } from './util.js';
import { photoMarkup, statTile, formatHours, pageHead, emptyState, loading, itemPath } from './components.js';

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
  return `<svg viewBox="0 0 ${width} ${height}" class="daily-chart" role="img" aria-label="Posts and returns per day, last 14 days">${bars}</svg>
    <div class="chart-legend"><span class="key-posts"></span>Posts <span class="key-returned"></span>Returned</div>`;
}

function categoryBars(rows) {
  const max = Math.max(1, ...rows.map(row => row.lost + row.found));
  return rows.map(row => `<div class="cat-row"><span>${escapeHTML(row.label)}</span>
    <div class="cat-bar"><i class="lost" style="width:${(row.lost / max) * 100}%"></i><i class="found" style="width:${(row.found / max) * 100}%"></i></div><b>${row.lost + row.found}</b></div>`).join('')
    || '<p class="muted">No posts yet.</p>';
}

function flaggedList(items) {
  if (!items.length) return emptyState('🛡️', 'Nothing to review', 'Reported posts show up here. Three reports hide a post automatically.');
  return items.map(item => `<article class="flag-row">
    <div class="flag-photo">${photoMarkup(item)}</div>
    <div class="flag-main"><a href="${itemPath(item)}"><b>${escapeHTML(itemTitle(item))}</b></a>
      <small>${item.status === 'HIDDEN' ? '🚫 Hidden' : '⚠️ Reported'} · ${item.reportCount} report${item.reportCount === 1 ? '' : 's'} · ${escapeHTML([...new Set(item.reportReasons ?? [])].map(reason => REPORT_REASONS[reason] ?? reason).join(', '))} · by ${escapeHTML(item.ownerLabel)} ${escapeHTML(timeAgo(item.createdAt))}</small></div>
    <div class="flag-actions"><button class="button button-light" data-moderate="restore" data-id="${escapeHTML(item.itemId)}">Keep</button>
      <button class="button button-danger" data-moderate="remove" data-id="${escapeHTML(item.itemId)}">Remove</button></div></article>`).join('');
}

export async function renderAdmin(view) {
  if (!state.user?.isAdmin) {
    view.innerHTML = emptyState('🔒', 'Moderators only', 'Ask an existing moderator to add your account to the “admins” group.', '<a class="button button-dark" href="/">Home</a>');
    return;
  }
  view.innerHTML = `${pageHead('MODERATION', 'Campus dashboard', 'Live numbers from DynamoDB and the reported-posts queue.')}<div id="admin-body">${loading('Loading dashboard…')}</div>`;
  const draw = async () => {
    try {
      const { stats, flagged, stuck } = await state.backend.adminOverview();
      view.querySelector('#admin-body').innerHTML = `
        <div class="stats-grid">${[statTile(stats.total, 'posts (90 days)'), statTile(stats.openLost, 'open lost'), statTile(stats.openFound, 'open found'),
          statTile(stats.returned, 'returned'), statTile(`${stats.returnRate}%`, 'return rate'), statTile(formatHours(stats.medianHoursToReturn), 'median time to return')].join('')}</div>
        ${stuck ? `<p class="status-note">⚠️ ${stuck} photo${stuck === 1 ? '' : 's'} failed analysis; owners can retry from their post.</p>` : ''}
        <div class="admin-grid">
          <section class="panel"><h3>Last 14 days</h3>${dailyChart(stats.daily)}</section>
          <section class="panel"><h3>By category</h3><div class="cat-legend"><span class="lost"></span>Lost <span class="found"></span>Found</div>${categoryBars(stats.byCategory)}</section>
        </div>
        <section class="panel"><h3>Reported posts <span class="count-pill">${flagged.length}</span></h3>${flaggedList(flagged)}</section>`;
    } catch (error) {
      view.querySelector('#admin-body').innerHTML = `<p class="form-error">${escapeHTML(error.message)}</p>`;
    }
  };
  view.addEventListener('click', async event => {
    const button = event.target.closest('[data-moderate]');
    if (!button) return;
    if (button.dataset.moderate === 'remove' && !confirm('Remove this post for everyone? Its photo is deleted.')) return;
    try {
      toast((await state.backend.moderate(button.dataset.id, button.dataset.moderate)).message);
      await Promise.all([draw(), reloadItems()]);
    } catch (error) {
      toast(error.message);
    }
  });
  await draw();
}

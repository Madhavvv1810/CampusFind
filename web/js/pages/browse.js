// Browse: the full campus board with type filter, category, search and paging.
import { state, on, loadMoreItems } from '../state.js';
import { escapeHTML, categoryIcon, CATEGORIES, toast } from '../util.js';
import { grid, emptyState, shownType, pageHead } from '../components.js';

function visible(item) {
  if (state.filter === 'MINE' && !item.mine) return false;
  if ((state.filter === 'LOST' || state.filter === 'FOUND') && (shownType(item) !== state.filter || item.status === 'RESOLVED')) return false;
  if (state.filter === 'RETURNED' && item.status !== 'RESOLVED') return false;
  if (state.category && item.category !== state.category) return false;
  const search = state.search.trim().toLowerCase();
  return !search || [item.title, item.description, item.location, CATEGORIES[item.category], item.ownerLabel, ...(item.labels ?? [])]
    .join(' ').toLowerCase().includes(search);
}

export function renderBrowse(view, params, query) {
  state.filter = (query.get('type') ?? 'ALL').toUpperCase();
  state.category = query.get('category') ?? '';
  state.search = query.get('q') ?? '';
  const navKey = { LOST: 'lost', FOUND: 'found', RETURNED: 'returned' }[state.filter] ?? 'browse';
  document.querySelectorAll('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === navKey));
  view.innerHTML = `
    ${pageHead('THE CAMPUS BOARD', { ALL: 'Everything on the board', LOST: 'Lost items', FOUND: 'Found items', RETURNED: 'Back with their owners' }[state.filter] ?? 'Browse', 'Everything reported on campus in the last 90 days, newest first.', '<a class="button button-dark" href="/report/found">＋ Report found</a>')}
    <div class="toolbar">
      <div class="toolbar-right">
        <select id="category-filter" class="category-filter" aria-label="Category"><option value="">All categories</option>${Object.entries(CATEGORIES).map(([value, label]) => `<option value="${value}"${state.category === value ? ' selected' : ''}>${categoryIcon(value)} ${label}</option>`).join('')}</select>
        <label class="search-box"><span aria-hidden="true">⌕</span><input id="search" type="search" value="${escapeHTML(state.search)}" placeholder="Search items, places, people" aria-label="Search posts"></label>
      </div>
    </div>
    <p class="result-count" id="result-count" aria-live="polite"></p>
    <div id="feed"></div>
    <div class="load-more-row"><button id="load-more" class="button button-light hidden">Load older posts</button></div>`;

  const draw = () => {
    const items = state.items.filter(visible);
    view.querySelector('#result-count').textContent = `${items.length} post${items.length === 1 ? '' : 's'}`;
    view.querySelector('#feed').innerHTML = items.length ? grid(items)
      : emptyState('🔍', 'Nothing matches', 'Try another word, category or filter.', '<a class="button button-dark" href="/report/lost">Report what you lost</a>');
    view.querySelector('#load-more').classList.toggle('hidden', !state.cursor);
  };

  view.querySelector('#category-filter').addEventListener('change', event => { state.category = event.target.value; draw(); });
  view.querySelector('#search').addEventListener('input', event => { state.search = event.target.value; draw(); });
  view.querySelector('#load-more').addEventListener('click', () => loadMoreItems().catch(error => toast(error.message)));

  draw();
  const offItems = on('items', draw);
  const offThreads = on('threads', draw);
  return () => { offItems(); offThreads(); };
}

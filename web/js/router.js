// Client-side router with clean URLs (History API). CloudFront serves index.html for every path,
// so deep links like /item/abc work; each page renders into <main id="view">.
import { $, $$ } from './util.js';

const routes = [];
let cleanup = null;

/** Registers a page: pattern like "/item/:id", render(view, params, query) may return a cleanup function. */
export function route(pattern, { nav, title, render }) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/\/:(\w+)/g, (_, key) => { keys.push(key); return '/([^/]+)'; })}/?$`);
  routes.push({ regex, keys, nav, title, render });
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return resolve();
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  return resolve();
}

export async function resolve() {
  const path = location.pathname;
  const match = routes.map(entry => ({ entry, found: path.match(entry.regex) })).find(({ found }) => found)
    ?? { entry: routes.find(entry => entry.nav === 'notfound'), found: [] };
  const params = Object.fromEntries(match.entry.keys.map((key, index) => [key, decodeURIComponent(match.found[index + 1] ?? '')]));

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  $$('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === match.entry.nav));
  $$('[data-nav]').forEach(link => link.toggleAttribute('aria-current', link.dataset.nav === match.entry.nav));
  $('#main-nav').classList.remove('open');
  $('#nav-toggle').setAttribute('aria-expanded', 'false');
  for (const dialog of $$('dialog[open]')) dialog.close();

  // A fresh <main> per page, so listeners from the previous page cannot leak.
  const old = $('#view');
  const view = old.cloneNode(false);
  old.replaceWith(view);
  document.title = `${typeof match.entry.title === 'function' ? match.entry.title(params) : match.entry.title} · CampusFind`;
  window.scrollTo({ top: 0 });
  cleanup = await match.entry.render(view, params, new URLSearchParams(location.search));
  view.focus({ preventScroll: true });
}

/** Same-origin links navigate without a page reload. */
export function startRouter() {
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || link.target || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || url.pathname.match(/\.\w+$/)) return;
    event.preventDefault();
    navigate(url.pathname + url.search);
  });
  window.addEventListener('popstate', resolve);
  // Links shared before clean URLs (#item=<id>) still work.
  const legacy = location.hash.match(/^#item=([^&]+)/);
  if (legacy) history.replaceState(null, '', `/item/${legacy[1]}`);
  return resolve();
}

// Boot: choose the backend (signed-in cloud or in-browser demo), register pages, start polling.
import { state, emit, reloadItems, reloadInbox, isCloud } from './state.js';
import { $, toast, CATEGORIES, categoryIcon } from './util.js';
import { cloudConfigured, finishSignIn, currentUser, signIn, signOut } from './auth.js';
import { cloudBackend } from './backend-cloud.js';
import { createDemoBackend } from './backend-demo.js';
import { route, startRouter, navigate } from './router.js';
import { setupChat, openContact, renderMessages } from './chat.js';
import { renderHome } from './pages/home.js';
import { renderBrowse } from './pages/browse.js';
import { renderReport } from './pages/report.js';
import { renderItem } from './pages/item.js';
import { renderMine } from './pages/mine.js';
import { renderAbout, renderNotFound } from './pages/about.js';
import { renderAdmin } from './admin.js';

const BOARD_POLL_MS = 30_000;

/** Pages that change data need a signed-in student when the cloud is configured. */
const requireAccount = render => (view, ...args) => {
  if (state.user || !cloudConfigured()) return render(view, ...args);
  view.innerHTML = `<div class="empty-state page-empty"><div class="empty-icon">🎓</div><h3>Sign in with your college email</h3>
    <p>Reporting items and messaging finders needs a verified college account. It takes a minute.</p>
    <div class="hero-actions"><button class="button button-light" data-auth="signup">Create account</button><button class="button button-dark" data-auth="login">Sign in</button></div></div>`;
  return undefined;
};

route('/', { nav: 'home', title: 'Lost, found, and back together', render: renderHome });
route('/browse', { nav: 'browse', title: 'Browse', render: renderBrowse });
route('/report/:type', { nav: 'report', title: 'Report an item', render: requireAccount(renderReport) });
route('/item/:id', { nav: 'browse', title: 'Item', render: renderItem });
route('/item/:id/edit', { nav: 'mine', title: 'Edit post', render: requireAccount(renderReport) });
route('/messages', { nav: 'messages', title: 'Messages', render: requireAccount(renderMessages) });
route('/messages/:itemId/:claimId', { nav: 'messages', title: 'Messages', render: requireAccount(renderMessages) });
route('/profile', { nav: 'mine', title: 'Profile', render: requireAccount(renderMine) });
route('/my-posts', { nav: 'mine', title: 'Profile', render: requireAccount(renderMine) });
route('/admin', { nav: 'admin', title: 'Admin', render: renderAdmin });
route('/about', { nav: 'about', title: 'About', render: renderAbout });
route('/404', { nav: 'notfound', title: 'Not found', render: renderNotFound });

function renderHeader() {
  const cloud = isCloud();
  $('#cloud-status').innerHTML = cloud ? `<i class="is-cloud"></i> ${state.user.name}` : '<i></i> Sample board';
  $('#login').classList.toggle('hidden', cloud || !cloudConfigured());
  $('#logout').classList.toggle('hidden', !cloud);
  $('#admin-link').classList.toggle('hidden', !state.user?.isAdmin);
  $('#sample-banner').classList.toggle('hidden', cloud);
  for (const id of ['#banner-signup', '#banner-login']) $(id).classList.toggle('hidden', !cloudConfigured());
}

function wireChrome() {
  setupChat();
  $('#mega-menu').innerHTML = `<div class="mega-col"><h4>Browse by category</h4>${Object.entries(CATEGORIES).map(([key, label]) => `<a href="/browse?category=${key}">${categoryIcon(key)} ${label}</a>`).join('')}</div>
    <div class="mega-col"><h4>Quick links</h4><a href="/browse?type=lost">Open lost reports</a><a href="/browse?type=found">Open found items</a><a href="/browse?type=returned">Recently returned</a><a href="/report/found">Report a found item</a></div>`;
  $('#header-search').addEventListener('submit', event => {
    event.preventDefault();
    const q = event.target.elements.q.value.trim();
    navigate(`/browse${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  });
  $('#nav-toggle').addEventListener('click', () => {
    const open = $('#main-nav').classList.toggle('open');
    $('#nav-toggle').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    const auth = event.target.closest('[data-auth]');
    if (auth) signIn(auth.dataset.auth);
    const contact = event.target.closest('#view .card-buttons [data-contact]');
    if (contact) { event.preventDefault(); state.user || !cloudConfigured() ? openContact(contact.dataset.contact) : signIn(); }
  });
  $('#login').addEventListener('click', () => signIn());
  $('#banner-login').addEventListener('click', () => signIn());
  $('#banner-signup').addEventListener('click', () => signIn('signup'));
  $('#logout').addEventListener('click', signOut);
  $('#demo-reset').addEventListener('click', async () => {
    state.backend.reset();
    await Promise.all([reloadItems(), reloadInbox()]);
    toast('Sample board restored.');
  });
}

/** Keep the board and inbox fresh while the tab is visible; announce new messages. */
function startPolling() {
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    const before = state.unread;
    await Promise.all([reloadItems(), reloadInbox()]).catch(() => {});
    if (state.unread > before && !location.pathname.startsWith('/messages/')) toast(`You have ${state.unread} unread message${state.unread === 1 ? '' : 's'}.`);
    if (state.items.some(item => item.mine && item.status === 'PROCESSING')) setTimeout(tick, 4000);
  };
  setInterval(tick, BOARD_POLL_MS);
  document.addEventListener('visibilitychange', tick);
  return tick;
}

async function boot() {
  wireChrome();
  let returnTo = null;
  if (cloudConfigured()) {
    try { returnTo = await finishSignIn(); } catch (error) { toast(error.message); }
  }
  state.user = cloudConfigured() ? currentUser() : null;
  state.backend = state.user ? cloudBackend : createDemoBackend({ onChange: () => Promise.all([reloadItems(), reloadInbox()]) });
  state.statsBackend = cloudConfigured() ? cloudBackend : state.backend; // campus stats are public
  renderHeader();
  emit('user');

  try { await Promise.all([reloadItems(), reloadInbox()]); } catch (error) { toast(error.message); }
  const tick = startPolling();
  if (state.items.some(item => item.mine && item.status === 'PROCESSING')) setTimeout(tick, 4000);
  if (returnTo) history.replaceState(null, '', returnTo);
  await startRouter();
  if (!isCloud() && cloudConfigured() && location.pathname === '/') toast('You are viewing a sample board. Sign in with your college email to see the real one.');
}

boot();

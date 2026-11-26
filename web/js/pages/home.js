// Home: what CampusFind is, live campus numbers, how it works and the latest found items.
import { state, on } from '../state.js';
import { escapeHTML } from '../util.js';
import { grid, statTile, formatHours, loading } from '../components.js';

const STEPS = [
  ['📸', 'Post it', 'Lost something? Describe it. Found something? Snap a photo and say where you left it. It takes about a minute.'],
  ['🧭', 'Get matched', 'CampusFind looks for similar posts by photo, description and place, and shows you the closest ones side by side.'],
  ['💬', 'Chat privately', '“This is mine” opens a private chat. Prove it with a detail only the owner knows; no phone numbers on public display.'],
  ['✅', 'Hand it back', 'The finder confirms the return and both posts close. Everyone can see how many items found their way home.'],
];

async function renderStats(target) {
  try {
    const stats = await state.statsBackend.stats();
    target.innerHTML = [
      statTile(stats.returned, 'items returned'),
      statTile(stats.openLost + stats.openFound, 'open posts'),
      statTile(`${stats.returnRate}%`, 'return rate'),
      statTile(formatHours(stats.medianHoursToReturn), 'typical time to return'),
    ].join('');
  } catch {
    target.remove();
  }
}

function recentFound() {
  const found = state.items.filter(item => item.itemType === 'FOUND' && item.status === 'ACTIVE').slice(0, 6);
  return found.length ? grid(found) : '<p class="muted">No open found items right now.</p>';
}

export function renderHome(view) {
  view.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow"><span class="eyebrow-dot"></span> THE CAMPUS LOST &amp; FOUND</div>
        <h1>Lost something?<br><em>Let’s find it.</em></h1>
        <p>One place for every lost and found item on campus. CampusFind matches posts automatically and lets you chat privately until it is back with its owner.</p>
        <div class="hero-actions">
          <a class="button button-dark" href="/report/lost">I lost something <span>↗</span></a>
          <a class="button button-outline" href="/report/found">I found something <span>＋</span></a>
        </div>
        <div class="hero-note">College accounts only · Photos stay private · No phone numbers on show</div>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="orb orb-one"></div><div class="orb orb-two"></div>
        <div class="hero-card card-back"><div class="mini-photo mini-book">📓</div><div><small>FOUND · LIBRARY</small><b>Blue notebook</b></div><span>↗</span></div>
        <div class="hero-card card-front"><div class="mini-photo mini-keys">🔑</div><div><small>92% MATCH</small><b>Keys with green tag</b></div><span class="match-check">✓</span></div>
        <div class="hero-spark">✳</div>
      </div>
    </section>

    <section class="stats-strip" id="home-stats" aria-label="Campus activity">${loading('Loading campus numbers…')}</section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">HOW IT WORKS</div><h2>From lost to returned in four steps</h2></div></div>
      <ol class="steps">${STEPS.map(([icon, title, text], index) => `
        <li class="step"><span class="step-icon">${icon}</span><small>STEP ${index + 1}</small><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p></li>`).join('')}
      </ol>
    </section>

    <section class="section">
      <div class="section-head"><div><div class="eyebrow">JUST HANDED IN</div><h2>Recently found on campus</h2></div><a class="button button-light" href="/browse">Browse everything →</a></div>
      <div id="home-recent">${recentFound()}</div>
    </section>

    <section class="cta-band">
      <div><h2>Found something today?</h2><p>It takes a minute to post, and the owner gets matched automatically.</p></div>
      <a class="button button-dark" href="/report/found">Report a found item</a>
    </section>`;

  renderStats(view.querySelector('#home-stats'));
  return on('items', () => { const target = view.querySelector('#home-recent'); if (target) target.innerHTML = recentFound(); });
}

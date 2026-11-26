// About: what CampusFind is, privacy, tips and common questions (written for students, not developers).
import { pageHead } from '../components.js';

const FAQ = [
  ['Who can use CampusFind?', 'Anyone with a college email address. Accounts are verified by email, and sign-ups from other domains are rejected.'],
  ['Who sees my photos and messages?', 'Only signed-in students can see photos, and a chat can only be read by the two people in it.'],
  ['How are matches found?', 'CampusFind compares your post with what others have reported, looking at the photo, the description, the category and the place. It shows you the closest ones side by side, and you confirm in chat.'],
  ['What happens to old posts?', 'Posts are removed automatically after 90 days. You can mark your post as returned or delete it at any time.'],
  ['What if a post is fake or offensive?', 'Use “Report this post” on its page. After three reports it is hidden until a moderator reviews it.'],
];

const TIPS = [
  ['⏱', 'Post quickly', 'The sooner you post, the sooner a finder can spot it and get in touch.'],
  ['📍', 'Be specific', '“LT-3, row 5” finds things faster than “a lecture hall”.'],
  ['🔒', 'Keep one secret', 'Leave one detail out of your post so you can prove the item is yours.'],
  ['🏷️', 'Hand in valuables', 'Found a wallet or phone? Give it to the security office and say so in your post.'],
];

export function renderAbout(view) {
  view.innerHTML = `
    ${pageHead('ABOUT', 'How CampusFind works', 'The easiest way to get lost things back on campus.')}
    <section class="section two-col">
      <div>
        <h2>Why it exists</h2>
        <p>Lost items usually end up in a dozen group chats, a notice board and three help desks. Owners repeat descriptions, finders do not know whom to tell, and phone numbers end up public. CampusFind puts everything in one searchable board, suggests matches automatically and keeps contact private.</p>
        <h2>Privacy by design</h2>
        <ul class="checklist">
          <li>Other students see your first name and initial, never your email.</li>
          <li>Your photo’s location information is removed before it is posted.</li>
          <li>Only signed-in students can see photos.</li>
          <li>Share your phone number only inside a chat, and only if you want to.</li>
        </ul>
      </div>
      <div><h2>Common questions</h2><div class="faq">${FAQ.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join('')}</div></div>
    </section>
    <section class="section">
      <div class="section-head"><div><div class="eyebrow">GOOD TO KNOW</div><h2>Tips for getting your item back</h2></div></div>
      <ol class="steps">${TIPS.map(([icon, title, text]) => `<li class="step"><span class="step-icon">${icon}</span><h3>${title}</h3><p>${text}</p></li>`).join('')}</ol>
    </section>
    <section class="cta-band">
      <div><h2>Lost something today?</h2><p>Post it now: similar found items show up on your post as soon as someone reports them.</p></div>
      <a class="button button-dark" href="/report/lost">Report a lost item</a>
    </section>`;
}

export function renderNotFound(view) {
  view.innerHTML = `<div class="empty-state page-empty"><div class="empty-icon">🧭</div><h3>This page could not be found</h3>
    <p>The link may be old, or the post may have expired.</p><a class="button button-dark" href="/browse">Browse the board</a></div>`;
}

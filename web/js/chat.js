// Private chats: the "This is mine" dialog (any page) and the two-pane Messages page.
import { state, on, findItem, reloadInbox, reloadItems, isCloud } from './state.js';
import { $, escapeHTML, itemTitle, dateText, timeAgo, toast, busy, openDialog } from './util.js';
import { pageHead, emptyState } from './components.js';
import { navigate } from './router.js';

const THREAD_POLL_MS = 6000;
const keyOf = thread => `${thread.itemId}/${thread.claimId}`;
const threadPath = thread => `/messages/${encodeURIComponent(thread.itemId)}/${encodeURIComponent(thread.claimId)}`;
const otherName = thread => (thread.role === 'owner' ? thread.claimantLabel || 'Student' : thread.ownerLabel || (thread.itemType === 'FOUND' ? 'Finder' : 'Owner'));
const statusChip = status => `<span class="chat-chip chip-${escapeHTML(String(status).toLowerCase())}">${{ OPEN: 'Open', ACCEPTED: 'Returned', DECLINED: 'Not a match' }[status] ?? escapeHTML(status)}</span>`;

// ---------- "This is mine" / "I found this" dialog ----------
export async function openContact(targetItemId, sourceItemId = null) {
  const existing = state.threads.find(thread => thread.itemId === targetItemId && thread.role === 'claimant' && thread.status !== 'DECLINED');
  if (existing) { navigate(threadPath(existing)); return; }
  const target = findItem(targetItemId) ?? await state.backend.getItem(targetItemId);
  const finder = target.itemType === 'FOUND';
  const form = $('#claim-form');
  form.reset();
  $('#claim-error').textContent = '';
  form.elements.itemId.value = targetItemId;
  form.elements.matchedItemId.value = sourceItemId && sourceItemId !== targetItemId ? sourceItemId : '';
  $('#claim-title').textContent = finder ? 'This is mine' : 'I found this';
  $('#claim-intro').textContent = finder
    ? `Start a private chat with whoever found “${itemTitle(target)}”. Mention something only the owner would know: a mark, sticker, lock screen or what is inside.`
    : `Start a private chat with the owner of “${itemTitle(target)}”. Say where and when you found it.`;
  form.elements.message.placeholder = finder ? 'e.g. It has a scratch under the cap and my initials inside the lid.' : 'e.g. Found it on the second floor of the library around 3 pm.';
  openDialog('#claim-dialog');
  form.elements.message.focus();
}

async function submitContact(event) {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  const form = event.currentTarget;
  const message = form.elements.message.value.trim();
  if (message.length < 8) { $('#claim-error').textContent = 'Add a detail that helps them check it is the right item.'; return; }
  await busy($('#claim-submit'), 'Sending…', async () => {
    try {
      const claim = await state.backend.startChat(form.elements.itemId.value, {
        message, contact: form.elements.contact.value.trim(), matchedItemId: form.elements.matchedItemId.value || undefined,
      });
      $('#claim-dialog').close();
      await reloadInbox();
      navigate(threadPath(claim));
      toast('Message sent privately.');
    } catch (error) {
      $('#claim-error').textContent = error.message;
    }
  });
}

// ---------- Messages page ----------
function listMarkup(threads, activeKey) {
  if (!threads.length) return emptyState('✉️', 'No conversations yet', 'Press “This is mine” or “I found this” on a post to start a private chat.', '<a class="button button-dark" href="/browse">Browse the board</a>');
  return threads.map(thread => {
    const last = thread.messages.at(-1) ?? {};
    const prefix = last.from === thread.role ? 'You: ' : last.from === 'system' ? '' : `${otherName(thread)}: `;
    return `<a class="inbox-row${thread.unread ? ' unread' : ''}${keyOf(thread) === activeKey ? ' active' : ''}" href="${threadPath(thread)}">
      <span class="inbox-avatar">${escapeHTML(otherName(thread).slice(0, 1).toUpperCase())}</span>
      <span class="inbox-main"><b>${escapeHTML(thread.itemTitle || 'Item')}</b>
        <small>${thread.role === 'owner' ? `${escapeHTML(otherName(thread))} · your ${thread.itemType === 'FOUND' ? 'found' : 'lost'} post` : `You → ${escapeHTML(otherName(thread))}`}</small>
        <span class="inbox-preview">${escapeHTML(prefix + (last.text ?? ''))}</span></span>
      <span class="inbox-side">${escapeHTML(timeAgo(thread.updatedAt))}${statusChip(thread.status)}${thread.unread ? '<i class="unread-dot"></i>' : ''}</span>
    </a>`;
  }).join('');
}

function threadMarkup(thread) {
  const owner = thread.role === 'owner';
  const item = findItem(thread.itemId);
  const closed = thread.status === 'DECLINED';
  const decisions = owner && thread.status === 'OPEN' && (!item || item.status === 'ACTIVE')
    ? `<div class="thread-actions"><span>Sure it is theirs?</span><button type="button" class="button button-light" data-decide="DECLINED">Not a match</button>
       <button type="button" class="button button-dark" data-decide="ACCEPTED">${thread.itemType === 'LOST' ? 'I got it back' : 'Returned it'}</button></div>` : '';
  return `
    <header class="thread-head">
      <a class="back-link only-mobile" href="/messages">← All messages</a>
      <h2><a href="/item/${encodeURIComponent(thread.itemId)}">${escapeHTML(thread.itemTitle || 'Conversation')}</a></h2>
      <p class="modal-intro">${owner ? `${escapeHTML(otherName(thread))} ${thread.requestType === 'FOUND_FOR_OWNER' ? 'says they found your item' : 'says this item is theirs'}` : `Private chat with ${escapeHTML(otherName(thread))}`} ${statusChip(thread.status)}</p>
      ${thread.contact ? `<p class="private-contact">${owner ? 'Their contact' : 'You shared'}: ${escapeHTML(thread.contact)}</p>` : ''}
    </header>
    <div class="chat-log" id="chat-log" aria-live="polite">${thread.messages.map(message => {
      if (message.from === 'system') return `<div class="bubble system">${escapeHTML(message.text)}</div>`;
      const mine = message.from === thread.role;
      return `<div class="bubble ${mine ? 'me' : 'them'}"><small>${mine ? 'You' : escapeHTML(otherName(thread))} · ${escapeHTML(dateText(message.at, { hour: 'numeric', minute: '2-digit' }))}</small>${escapeHTML(message.text)}</div>`;
    }).join('')}</div>
    ${decisions}
    <form id="thread-form" class="chat-compose" novalidate>
      <textarea name="text" rows="2" maxlength="500" aria-label="Message" ${closed ? 'disabled' : ''}
        placeholder="${closed ? 'This conversation was closed.' : owner && thread.status === 'OPEN' ? 'Ask a question to check it is theirs, or say where to collect it…' : 'Write a message…'}"></textarea>
      <button class="button button-dark" type="submit" ${closed ? 'disabled' : ''}>Send</button>
    </form>
    <p id="thread-error" class="form-error" role="alert"></p>`;
}

export function renderMessages(view, params, query) {
  const filterItem = query.get('item');
  const activeKey = params.itemId ? `${params.itemId}/${params.claimId}` : null;
  view.innerHTML = `${pageHead('PRIVATE MESSAGES', 'Messages', 'Only the two people in a chat can read it.')}
    <div class="messages-layout${activeKey ? ' has-thread' : ''}"><aside class="inbox-list" id="inbox-list"></aside><section class="thread-pane" id="thread-pane"></section></div>`;

  const current = () => state.threads.find(thread => keyOf(thread) === activeKey);
  const drawList = () => {
    const threads = state.threads.filter(thread => !filterItem || thread.itemId === filterItem);
    view.querySelector('#inbox-list').innerHTML = (filterItem ? '<a class="link-button" href="/messages">← All conversations</a>' : '') + listMarkup(threads, activeKey);
  };
  const drawThread = () => {
    const pane = view.querySelector('#thread-pane');
    const thread = current();
    if (!thread) {
      pane.innerHTML = emptyState('💬', activeKey ? 'Conversation not found' : 'Pick a conversation', activeKey ? 'It may have expired.' : 'Choose a chat on the left to read and reply.');
      return;
    }
    const draft = pane.querySelector('textarea')?.value ?? '';
    pane.innerHTML = threadMarkup(thread);
    pane.querySelector('textarea').value = draft;
    const log = pane.querySelector('#chat-log');
    log.scrollTop = log.scrollHeight;
  };
  const markSeen = async () => {
    const thread = current();
    if (!thread?.unread) return;
    try { await state.backend.markSeen(thread.itemId, thread.claimId); await reloadInbox(); } catch { /* next poll retries */ }
  };

  view.querySelector('#thread-pane').addEventListener('submit', async event => {
    event.preventDefault();
    const thread = current();
    const input = event.target.elements.text;
    const text = input.value.trim();
    if (!thread || !text) return;
    await busy(event.target.querySelector('button'), 'Sending…', async () => {
      try {
        const updated = await state.backend.sendMessage(thread.itemId, thread.claimId, text);
        input.value = '';
        state.threads = [updated, ...state.threads.filter(other => keyOf(other) !== keyOf(updated))];
        drawList();
        drawThread();
      } catch (error) {
        view.querySelector('#thread-error').textContent = error.message;
      }
    });
  });
  view.querySelector('#thread-pane').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && event.target.matches('textarea')) { event.preventDefault(); event.target.form.requestSubmit(); }
  });
  view.querySelector('#thread-pane').addEventListener('click', async event => {
    const button = event.target.closest('[data-decide]');
    const thread = current();
    if (!button || !thread) return;
    const status = button.dataset.decide;
    if (status === 'ACCEPTED' && !confirm('Mark this item as returned? Both linked posts will close.')) return;
    try {
      await state.backend.decide(thread.itemId, thread.claimId, status, view.querySelector('textarea').value.trim());
      view.querySelector('textarea').value = '';
      await Promise.all([reloadInbox(), reloadItems()]);
      toast(status === 'ACCEPTED' ? 'Marked as returned. Both posts are closed.' : 'Marked as not a match. The chat is closed.');
    } catch (error) {
      toast(error.message);
    }
  });

  drawList();
  drawThread();
  markSeen();
  const off = on('threads', () => { drawList(); drawThread(); markSeen(); });
  const poll = isCloud() && activeKey ? setInterval(() => reloadInbox().catch(() => {}), THREAD_POLL_MS) : null;
  return () => { off(); clearInterval(poll); };
}

/** Badge in the nav bar and the tab title. */
export function setupChat() {
  on('threads', () => {
    $('#inbox-badge').textContent = state.unread;
    $('#inbox-badge').classList.toggle('hidden', !state.unread);
    document.title = document.title.replace(/^\(\d+\) /, '');
    if (state.unread) document.title = `(${state.unread}) ${document.title}`;
  });
  $('#claim-form').addEventListener('submit', submitContact);
}

// Private chats ("claims"): one per student per post, between that student and the post owner.
import crypto from 'node:crypto';
import { fail, ok, created } from '../http.js';
import { chatMessage, text } from '../validation.js';
import { publicClaim, roleIn, seenField, itemTitle } from '../views.js';
import { loadItem } from './items.js';

/** Stable, non-reversible chat key per student, so user IDs are never exposed in URLs. */
export const claimKey = userId => crypto.createHash('sha256').update(userId).digest('hex').slice(0, 32);

async function loadChat(deps, user, itemId, claimId) {
  const claim = await deps.store.getClaim(itemId, claimId);
  const role = claim && roleIn(claim, user.id);
  if (!role) fail(404, 'Conversation not found.');
  return { claim, role };
}

/** Owner: every chat about the post. Anyone else: only their own chat. */
export async function listChats({ deps, user, params }) {
  const item = await loadItem(deps, user, params.itemId);
  const claims = item.ownerId === user.id
    ? await deps.store.claimsForItem(item.itemId)
    : [await deps.store.getClaim(item.itemId, claimKey(user.id))].filter(Boolean);
  return ok({ claims: claims.map(claim => publicClaim(claim, user.id)) });
}

/** "This is mine" / "I found this": start a chat with the post owner. */
export async function startChat({ deps, user, params, body }) {
  const item = await loadItem(deps, user, params.itemId);
  if (item.ownerId === user.id) fail(400, 'You cannot message your own post.');
  if (item.status !== 'ACTIVE') fail(409, 'This post is no longer open for messages.');
  const message = chatMessage(body.message, { min: 8 });

  // Optional: the student's own opposite post, so a confirmed handoff closes both.
  const matchedItemId = text(body.matchedItemId, 80) || null;
  if (matchedItemId) {
    const matched = await deps.store.getItem(matchedItemId);
    const valid = matched && matched.itemId !== item.itemId && matched.ownerId === user.id && matched.status === 'ACTIVE'
      && matched.itemType !== item.itemType && (!matched.category || !item.category || matched.category === item.category);
    if (!valid) fail(403, 'Your matching post is no longer available to link.');
  }

  const now = deps.clock();
  const at = now.toISOString();
  const claim = {
    itemId: item.itemId,
    claimId: claimKey(user.id),
    claimantId: user.id,
    claimantLabel: user.name,
    ownerId: item.ownerId,
    ownerLabel: item.ownerLabel,
    itemTitle: itemTitle(item),
    itemType: item.itemType,
    category: item.category || null,
    matchedItemId,
    requestType: item.itemType === 'LOST' ? 'FOUND_FOR_OWNER' : 'OWNER_CLAIM',
    contact: text(body.contact, 120),
    status: 'OPEN',
    messages: [{ from: 'claimant', text: message, at }],
    createdAt: at,
    updatedAt: at,
    claimantSeenAt: at,
    expiresAt: Math.floor(now.getTime() / 1000) + deps.retentionDays * 86_400,
  };
  await deps.store.createClaim(claim);
  return created({ claim: publicClaim(claim, user.id) });
}

export async function sendMessage({ deps, user, params, body }) {
  const { claim, role } = await loadChat(deps, user, params.itemId, params.claimId);
  if (claim.status === 'DECLINED') fail(409, 'This conversation was closed by the post owner.');
  const at = deps.clock().toISOString();
  const entry = { from: role, text: chatMessage(body.text), at };
  const updated = await deps.store.appendMessages(claim.itemId, claim.claimId, [entry], { updatedAt: at, [seenField(role)]: at });
  return created({ claim: publicClaim(updated, user.id) });
}

/** `{ seen: true }` marks the chat read; the owner sends `{ status: 'ACCEPTED' | 'DECLINED', reply }`. */
export async function updateChat({ deps, user, params, body }) {
  const { claim, role } = await loadChat(deps, user, params.itemId, params.claimId);
  const at = deps.clock().toISOString();

  if (body.seen === true) {
    const updated = await deps.store.updateClaim(claim.itemId, claim.claimId, { [seenField(role)]: at });
    return ok({ claim: publicClaim(updated, user.id) });
  }

  if (role !== 'owner') fail(403, 'Only the person who posted this can accept or decline.');
  const decision = String(body.status ?? '').toUpperCase();
  if (!['ACCEPTED', 'DECLINED'].includes(decision)) fail(400, 'Choose accept or decline.');
  if (claim.status !== 'OPEN') fail(409, 'This conversation has already been handled. Refresh.');

  const reply = text(body.reply, 500);
  const entries = [
    ...(reply ? [{ from: 'owner', text: reply, at }] : []),
    { from: 'system', text: decision === 'ACCEPTED' ? 'The owner confirmed the match. The item is marked returned.' : 'The owner marked this as not a match.', at },
  ];
  const fields = { status: decision, reviewedAt: at, updatedAt: at, ownerSeenAt: at };

  if (decision === 'DECLINED') {
    const updated = await deps.store.appendMessages(claim.itemId, claim.claimId, entries, fields);
    return ok({ claim: publicClaim(updated, user.id) });
  }
  const item = await deps.store.getItem(claim.itemId);
  if (item?.status !== 'ACTIVE') fail(409, 'This post has already been resolved.');
  await deps.store.resolveHandoff({ claim, decision: fields, entries, at });
  return ok({ claim: publicClaim({ ...claim, ...fields, messages: [...claim.messages, ...entries] }, user.id) });
}

/** Every chat the student is in, newest first, with an unread count. */
export async function inbox({ deps, user }) {
  const threads = (await deps.store.claimsForUser(user.id))
    .map(claim => publicClaim(claim, user.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return ok({ threads, unread: threads.filter(thread => thread.unread).length });
}

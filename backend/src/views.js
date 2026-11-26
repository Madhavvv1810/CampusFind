// What the browser is allowed to see. User IDs, emails, photo fingerprints and reporter lists
// never leave the API; the browser gets `mine` / `role` flags instead.
import { CATEGORIES } from './validation.js';

export function itemTitle(item) {
  return item.title || `${item.itemType === 'FOUND' ? 'Found' : 'Lost'} ${CATEGORIES[item.category] ?? 'item'}`;
}

export function publicItem(item, user, imageUrl = null) {
  const { ownerId, visualHash, reportedBy, reportReasons, reportCount, expiresAt, matchKey, campusId, imageKey, ...visible } = item;
  return {
    ...visible,
    mine: Boolean(user && ownerId === user.id),
    imageUrl,
    ...(user?.isAdmin ? { reportCount: reportCount ?? 0, reportReasons: reportReasons ?? [] } : {}),
  };
}

export const roleIn = (claim, userId) => (claim.ownerId === userId ? 'owner' : claim.claimantId === userId ? 'claimant' : null);
export const seenField = role => (role === 'owner' ? 'ownerSeenAt' : 'claimantSeenAt');

/** A claim is a private chat about one post between its owner and one other student. */
export function publicClaim(claim, userId) {
  const { claimantId, ownerId, expiresAt, ...visible } = claim;
  const role = roleIn(claim, userId);
  const messages = claim.messages ?? [];
  const last = messages.at(-1);
  const seen = role ? claim[seenField(role)] : null;
  const unread = Boolean(role && last && last.from !== role && (!seen || seen < last.at));
  return { ...visible, messages, role, unread };
}

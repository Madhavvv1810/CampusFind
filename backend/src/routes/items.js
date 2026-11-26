// Posts: list, create, view, edit, resolve, delete, photo upload completion, matches and reports.
import { fail, ok, created, accepted } from '../http.js';
import { validateNewPost, validateEdit, reportReason, MAX_PHOTO_BYTES } from '../validation.js';
import { publicItem } from '../views.js';
import { rankMatches } from '../matching.js';

export const AUTO_HIDE_AFTER_REPORTS = 3;
const PAGE_SIZE = 60;

const isOwner = (item, user) => item.ownerId === user.id;
const canSee = (item, user) => item.status !== 'REMOVED' && (item.status !== 'HIDDEN' || isOwner(item, user) || user.isAdmin);

/** Loads a post the caller may see, or 404s. */
export async function loadItem(deps, user, itemId) {
  const item = await deps.store.getItem(itemId);
  if (!item || !canSee(item, user)) fail(404, 'This post no longer exists.');
  return item;
}

export async function toView(deps, item, user) {
  return publicItem(item, user, item.imageKey && item.status !== 'AWAITING_UPLOAD' ? await deps.files.viewUrl(item.imageKey) : null);
}

export async function listItems({ deps, user, query }) {
  const page = await deps.store.listItems(deps.campusId, { limit: PAGE_SIZE, cursor: query.cursor });
  const items = await Promise.all(page.items.filter(item => canSee(item, user)).map(item => toView(deps, item, user)));
  return ok({ items, cursor: page.cursor });
}

export async function createItem({ deps, user, body }) {
  const { itemType, fields, photo, visualHash } = validateNewPost(body);
  const now = deps.clock();
  const itemId = deps.newId();
  const item = {
    itemId,
    campusId: deps.campusId,
    itemType,
    ...fields,
    ownerId: user.id,
    ownerLabel: user.name,
    hasPhoto: Boolean(photo),
    labels: [],
    status: photo ? 'AWAITING_UPLOAD' : 'ACTIVE',
    createdAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + deps.retentionDays * 86_400, // DynamoDB TTL
    ...(fields.category ? { matchKey: `${itemType}#${fields.category}` } : {}),
    ...(photo ? { imageKey: `uploads/${itemId}/photo`, imageType: photo.contentType } : {}),
    ...(visualHash ? { visualHash } : {}),
  };
  await deps.store.createItem(item);
  const uploadUrl = photo ? await deps.files.uploadUrl(item.imageKey, photo.contentType) : null;
  return created({ item: publicItem(item, user), uploadUrl });
}

export async function getItem({ deps, user, params }) {
  const item = await loadItem(deps, user, params.itemId);
  return ok({ item: await toView(deps, item, user) });
}

/** Owner edits details, or marks the post resolved ("I got it back" / "Owner collected it"). */
export async function updateItem({ deps, user, params, body }) {
  const item = await loadItem(deps, user, params.itemId);
  if (!isOwner(item, user)) fail(403, 'Only the person who posted this can change it.');
  const at = deps.clock().toISOString();

  if (body.status !== undefined) {
    if (String(body.status).toUpperCase() !== 'RESOLVED') fail(400, 'A post can only be marked as resolved.');
    if (item.status !== 'ACTIVE') fail(409, 'This post is not open.');
    const updated = await deps.store.updateItem(item.itemId, { status: 'RESOLVED', resolvedAt: at, updatedAt: at }, { status: 'ACTIVE', ownerId: user.id });
    return ok({ item: await toView(deps, updated, user) });
  }

  if (['RESOLVED', 'REMOVED'].includes(item.status)) fail(409, 'A closed post can no longer be edited.');
  const changes = validateEdit(body, item);
  const category = changes.category ?? item.category;
  const updated = await deps.store.updateItem(
    item.itemId,
    { ...changes, matchKey: category ? `${item.itemType}#${category}` : null, editedAt: at, updatedAt: at },
    { ownerId: user.id, status: { not: 'REMOVED' } },
  );
  return ok({ item: await toView(deps, updated, user) });
}

/** The owner, or a moderator, removes a post. Its photo is deleted from S3. */
export async function deleteItem({ deps, user, params }) {
  const item = await loadItem(deps, user, params.itemId);
  if (!isOwner(item, user) && !user.isAdmin) fail(403, 'Only the person who posted this can delete it.');
  await removeItem(deps, item, user.isAdmin && !isOwner(item, user) ? 'moderator' : 'owner');
  return ok({ ok: true });
}

export async function removeItem(deps, item, removedBy) {
  const at = deps.clock().toISOString();
  await deps.store.updateItem(item.itemId, { status: 'REMOVED', removedAt: at, removedBy, updatedAt: at });
  if (item.imageKey) {
    try { await deps.files.remove(item.imageKey); }
    catch (error) { deps.log.warn('photo cleanup failed', { itemId: item.itemId, error: error.name }); }
  }
}

/** Called after the browser's direct S3 upload: verify the object, then queue analysis. */
export async function completeUpload({ deps, user, params }) {
  const item = await loadItem(deps, user, params.itemId);
  if (!isOwner(item, user)) fail(403, 'Only the person who posted this can upload its photo.');
  if (item.status === 'ACTIVE') return ok({ item: await toView(deps, item, user) });
  if (item.status === 'PROCESSING') return accepted({ status: 'PROCESSING', message: 'Photo analysis is already running.' });
  if (!['AWAITING_UPLOAD', 'PROCESSING_FAILED'].includes(item.status) || !item.imageKey) fail(409, 'This post is not waiting for a photo.');

  const size = await deps.files.size(item.imageKey);
  if (!size) fail(400, 'The photo has not finished uploading. Try again in a moment.');
  if (size > MAX_PHOTO_BYTES) fail(400, 'The photo is over the 5 MB limit.');

  await deps.store.updateItem(item.itemId, { status: 'PROCESSING' }, { ownerId: user.id, status: ['AWAITING_UPLOAD', 'PROCESSING_FAILED'] });
  try {
    await deps.analyzer.queue(item.itemId);
  } catch (error) {
    await deps.store.updateItem(item.itemId, { status: 'PROCESSING_FAILED' }, { status: 'PROCESSING' });
    throw error;
  }
  return accepted({ status: 'PROCESSING', message: 'Photo uploaded. Matching will be ready in a few seconds.' });
}

export async function matchesFor({ deps, user, params }) {
  const item = await loadItem(deps, user, params.itemId);
  if (item.status !== 'ACTIVE') return ok({ matches: [], status: item.status });
  const opposite = item.itemType === 'LOST' ? 'FOUND' : 'LOST';
  const candidates = await deps.store.matchCandidates(deps.campusId, opposite, item.category);
  const ranked = rankMatches(item, candidates.filter(candidate => candidate.ownerId !== item.ownerId));
  const matches = await Promise.all(ranked.map(async match => {
    const { sharedLabels, sameCategory, sameLocation, titleOverlap, photoSimilarity, score, sameType, sameColour, colourConflict } = match;
    return { ...(await toView(deps, match, user)), sharedLabels, sameCategory, sameLocation, titleOverlap, photoSimilarity, score, sameType, sameColour, colourConflict };
  }));
  return ok({ matches, status: item.status });
}

/** Any student can report a post once. After AUTO_HIDE_AFTER_REPORTS reports it is hidden for review. */
export async function reportItem({ deps, user, params, body }) {
  const item = await loadItem(deps, user, params.itemId);
  if (isOwner(item, user)) fail(400, 'You cannot report your own post.');
  const reason = reportReason(body.reason);
  const at = deps.clock().toISOString();
  const updated = await deps.store.reportItem(item.itemId, user.id, reason, at);
  if (updated.reportCount >= AUTO_HIDE_AFTER_REPORTS && updated.status === 'ACTIVE') {
    await deps.store.updateItem(item.itemId, { status: 'HIDDEN', hiddenAt: at }, { status: 'ACTIVE' });
    deps.log.info('post auto-hidden', { itemId: item.itemId, reports: updated.reportCount });
  }
  return ok({ ok: true, message: 'Thanks. A moderator will review this post.' });
}

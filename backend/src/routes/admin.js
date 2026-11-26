// Public campus stats and the moderator tools (Cognito group "admins").
import { fail, ok } from '../http.js';
import { campusStats } from '../stats.js';
import { loadItem, removeItem, toView } from './items.js';

/** Signed-out visitors see these on the home page, so they are cached briefly at the edge. */
export async function publicStats({ deps }) {
  const stats = campusStats(await deps.store.allItems(deps.campusId), deps.clock().getTime());
  return ok({ stats }, { 'cache-control': 'public, max-age=60' });
}

const requireAdmin = user => { if (!user.isAdmin) fail(403, 'Moderators only.'); };

export async function overview({ deps, user }) {
  requireAdmin(user);
  const items = await deps.store.allItems(deps.campusId);
  const flagged = items
    .filter(item => item.status === 'HIDDEN' || (item.status === 'ACTIVE' && (item.reportCount ?? 0) > 0))
    .sort((a, b) => (b.reportCount ?? 0) - (a.reportCount ?? 0));
  return ok({
    stats: campusStats(items, deps.clock().getTime()),
    flagged: await Promise.all(flagged.map(item => toView(deps, item, user))),
    stuck: items.filter(item => item.status === 'PROCESSING_FAILED').length,
  });
}

/** Restore a reported/hidden post, or remove it for good. */
export async function moderate({ deps, user, params, body }) {
  requireAdmin(user);
  const item = await loadItem(deps, user, params.itemId);
  const at = deps.clock().toISOString();
  if (body.action === 'restore') {
    await deps.store.updateItem(item.itemId, { status: 'ACTIVE', reportCount: 0, reportedBy: null, reportReasons: null, reviewedAt: at, reviewedBy: user.name }, { status: ['ACTIVE', 'HIDDEN'] });
    return ok({ ok: true, message: 'Post restored.' });
  }
  if (body.action === 'remove') {
    await removeItem(deps, item, 'moderator');
    return ok({ ok: true, message: 'Post removed.' });
  }
  return fail(400, 'Choose restore or remove.');
}

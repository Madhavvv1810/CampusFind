// In-memory stand-in for src/aws/store.js with the same interface and the same condition rules,
// so route tests check real state changes instead of mocked calls.
import { ConflictError } from '../src/http.js';

const clone = value => structuredClone(value);

function satisfies(record, expect) {
  return Object.entries(expect).every(([key, rule]) => {
    if (Array.isArray(rule)) return rule.includes(record[key]);
    if (rule && typeof rule === 'object' && 'not' in rule) return record[key] !== rule.not;
    if (rule && typeof rule === 'object' && 'exists' in rule) return (record[key] !== undefined) === rule.exists;
    return record[key] === rule;
  });
}

function apply(record, set) {
  for (const [key, value] of Object.entries(set)) {
    if (value === null || value === undefined) delete record[key];
    else record[key] = clone(value);
  }
  return record;
}

export function createMemoryStore({ items = [], claims = [] } = {}) {
  const itemMap = new Map(items.map(item => [item.itemId, clone(item)]));
  const claimMap = new Map(claims.map(claim => [`${claim.itemId}|${claim.claimId}`, clone(claim)]));
  const byNewest = (a, b) => b.createdAt.localeCompare(a.createdAt);

  return {
    itemMap,
    claimMap,

    async getItem(itemId) { return itemMap.has(itemId) ? clone(itemMap.get(itemId)) : null; },
    async createItem(item) {
      if (itemMap.has(item.itemId)) throw new ConflictError();
      itemMap.set(item.itemId, clone(item));
    },
    async listItems(campusId, { limit = 60, cursor } = {}) {
      const all = [...itemMap.values()].filter(item => item.campusId === campusId).sort(byNewest);
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + limit);
      return { items: clone(page), cursor: start + limit < all.length ? String(start + limit) : null };
    },
    async allItems(campusId) { return clone([...itemMap.values()].filter(item => item.campusId === campusId)); },
    async matchCandidates(campusId, itemType, category) {
      return clone([...itemMap.values()].filter(item => item.campusId === campusId && item.itemType === itemType
        && item.status === 'ACTIVE' && (!category || item.category === category)));
    },
    async updateItem(itemId, set, expect = {}) {
      const item = itemMap.get(itemId);
      if (!item || !satisfies(item, expect)) throw new ConflictError();
      return clone(apply(item, set));
    },
    async reportItem(itemId, userId, reason, at) {
      const item = itemMap.get(itemId);
      if (!item) throw new ConflictError();
      if ((item.reportedBy ?? []).includes(userId)) throw new ConflictError('You already reported this post. Thank you.');
      item.reportedBy = [...(item.reportedBy ?? []), userId];
      item.reportCount = (item.reportCount ?? 0) + 1;
      item.reportReasons = [...(item.reportReasons ?? []), reason];
      item.lastReportedAt = at;
      return clone(item);
    },

    async getClaim(itemId, claimId) { const claim = claimMap.get(`${itemId}|${claimId}`); return claim ? clone(claim) : null; },
    async createClaim(claim) {
      const existing = claimMap.get(`${claim.itemId}|${claim.claimId}`);
      if (existing && existing.status !== 'DECLINED') throw new ConflictError('You already have a conversation about this post. Open it from Messages.');
      claimMap.set(`${claim.itemId}|${claim.claimId}`, clone(claim));
    },
    async claimsForItem(itemId) { return clone([...claimMap.values()].filter(claim => claim.itemId === itemId)); },
    async claimsForUser(userId) { return clone([...claimMap.values()].filter(claim => claim.ownerId === userId || claim.claimantId === userId)); },
    async updateClaim(itemId, claimId, set, expect = {}) {
      const claim = claimMap.get(`${itemId}|${claimId}`);
      if (!claim || !satisfies(claim, expect)) throw new ConflictError();
      return clone(apply(claim, set));
    },
    async appendMessages(itemId, claimId, entries, set = {}, maxMessages = 100) {
      const claim = claimMap.get(`${itemId}|${claimId}`);
      if (!claim || claim.status === 'DECLINED' || claim.messages.length >= maxMessages) throw new ConflictError();
      apply(claim, set);
      claim.messages.push(...clone(entries));
      return clone(claim);
    },
    async resolveHandoff({ claim, decision, entries, at }) {
      const stored = claimMap.get(`${claim.itemId}|${claim.claimId}`);
      const targets = [[claim.itemId, claim.ownerId], ...(claim.matchedItemId ? [[claim.matchedItemId, claim.claimantId]] : [])];
      const ok = stored?.status === 'OPEN' && targets.every(([id, owner]) => itemMap.get(id)?.status === 'ACTIVE' && itemMap.get(id)?.ownerId === owner);
      if (!ok) throw new ConflictError(); // all-or-nothing, like a DynamoDB transaction
      apply(stored, decision);
      stored.messages.push(...clone(entries));
      for (const [id] of targets) apply(itemMap.get(id), { status: 'RESOLVED', resolvedAt: at, updatedAt: at, resolutionClaimId: claim.claimId });
    },
  };
}

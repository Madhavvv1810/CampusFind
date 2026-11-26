// DynamoDB access for posts ("items") and chats ("claims"). Route code talks to this small,
// intention-named interface; tests swap in an in-memory version with the same behaviour.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConflictError } from '../http.js';

const CONFLICTS = new Set(['ConditionalCheckFailedException', 'TransactionCanceledException']);

async function guarded(promise) {
  try {
    return await promise;
  } catch (error) {
    if (CONFLICTS.has(error.name)) throw new ConflictError();
    throw error;
  }
}

/**
 * Builds a DynamoDB update from plain objects.
 *   set:    { field: value }  -> SET (null values are REMOVEd)
 *   expect: { field: value | [values] | { not: value } | { exists: bool } } -> ConditionExpression
 */
export function buildUpdate(set = {}, expect = {}) {
  const names = {};
  const values = {};
  const name = key => { names[`#${key}`] = key; return `#${key}`; };

  const sets = [];
  const removes = [];
  for (const [key, value] of Object.entries(set)) {
    if (value === null || value === undefined) removes.push(name(key));
    else { values[`:set_${key}`] = value; sets.push(`${name(key)} = :set_${key}`); }
  }

  const conditions = Object.entries(expect).map(([key, rule]) => {
    if (Array.isArray(rule)) {
      const options = rule.map((option, i) => { values[`:in_${key}_${i}`] = option; return `:in_${key}_${i}`; });
      return `${name(key)} IN (${options.join(', ')})`;
    }
    if (rule && typeof rule === 'object' && 'not' in rule) { values[`:not_${key}`] = rule.not; return `${name(key)} <> :not_${key}`; }
    if (rule && typeof rule === 'object' && 'exists' in rule) return `${rule.exists ? 'attribute_exists' : 'attribute_not_exists'}(${name(key)})`;
    values[`:eq_${key}`] = rule;
    return `${name(key)} = :eq_${key}`;
  });

  const parts = [];
  if (sets.length) parts.push(`SET ${sets.join(', ')}`);
  if (removes.length) parts.push(`REMOVE ${removes.join(', ')}`);
  return {
    UpdateExpression: parts.join(' '),
    ...(conditions.length ? { ConditionExpression: conditions.join(' AND ') } : {}),
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
  };
}

const encodeCursor = key => (key ? Buffer.from(JSON.stringify(key)).toString('base64url') : null);
function decodeCursor(cursor) {
  if (!cursor) return undefined;
  try { return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { return undefined; }
}

export function createDynamoStore({ itemsTable, claimsTable, client }) {
  const db = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const exists = { ConditionExpression: 'attribute_exists(itemId)' };

  async function queryAll(input, max = 2000) {
    const rows = [];
    let ExclusiveStartKey;
    do {
      const page = await db.send(new QueryCommand({ ...input, ExclusiveStartKey }));
      rows.push(...(page.Items ?? []));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey && rows.length < max);
    return rows;
  }

  return {
    async getItem(itemId) {
      return (await db.send(new GetCommand({ TableName: itemsTable, Key: { itemId } }))).Item ?? null;
    },

    async createItem(item) {
      await guarded(db.send(new PutCommand({ TableName: itemsTable, Item: item, ConditionExpression: 'attribute_not_exists(itemId)' })));
    },

    /** Newest first, one page at a time. */
    async listItems(campusId, { limit = 60, cursor } = {}) {
      const page = await db.send(new QueryCommand({
        TableName: itemsTable, IndexName: 'CampusIndex', ScanIndexForward: false, Limit: limit,
        KeyConditionExpression: 'campusId = :campus', ExpressionAttributeValues: { ':campus': campusId },
        ExclusiveStartKey: decodeCursor(cursor),
      }));
      return { items: page.Items ?? [], cursor: encodeCursor(page.LastEvaluatedKey) };
    },

    async allItems(campusId) {
      return queryAll({
        TableName: itemsTable, IndexName: 'CampusIndex', ScanIndexForward: false,
        KeyConditionExpression: 'campusId = :campus', ExpressionAttributeValues: { ':campus': campusId },
      });
    },

    /** Open posts of one type, narrowed by category through MatchIndex ("FOUND#keys"). */
    async matchCandidates(campusId, itemType, category) {
      const active = { FilterExpression: '#status = :active', ExpressionAttributeNames: { '#status': 'status' } };
      const input = category
        ? { IndexName: 'MatchIndex', KeyConditionExpression: 'matchKey = :key', ExpressionAttributeValues: { ':key': `${itemType}#${category}`, ':active': 'ACTIVE' } }
        : { IndexName: 'CampusIndex', KeyConditionExpression: 'campusId = :campus', ExpressionAttributeValues: { ':campus': campusId, ':active': 'ACTIVE' } };
      return queryAll({ TableName: itemsTable, ScanIndexForward: false, ...active, ...input }, 300);
    },

    /** Sets fields if every `expect` rule holds; returns the updated item. */
    async updateItem(itemId, set, expect = {}) {
      const update = buildUpdate(set, expect);
      const result = await guarded(db.send(new UpdateCommand({
        TableName: itemsTable, Key: { itemId }, ...update, ReturnValues: 'ALL_NEW',
        ConditionExpression: [exists.ConditionExpression, update.ConditionExpression].filter(Boolean).join(' AND '),
      })));
      return result.Attributes;
    },

    /** One report per student per post; returns the updated item. */
    async reportItem(itemId, userId, reason, at) {
      try {
        const result = await db.send(new UpdateCommand({
          TableName: itemsTable, Key: { itemId }, ReturnValues: 'ALL_NEW',
          UpdateExpression: 'ADD reportCount :one, reportedBy :user SET reportReasons = list_append(if_not_exists(reportReasons, :none), :reason), lastReportedAt = :at',
          ConditionExpression: 'attribute_exists(itemId) AND (attribute_not_exists(reportedBy) OR NOT contains(reportedBy, :userId))',
          ExpressionAttributeValues: { ':one': 1, ':user': new Set([userId]), ':userId': userId, ':none': [], ':reason': [reason], ':at': at },
        }));
        return result.Attributes;
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') throw new ConflictError('You already reported this post. Thank you.');
        throw error;
      }
    },

    async getClaim(itemId, claimId) {
      return (await db.send(new GetCommand({ TableName: claimsTable, Key: { itemId, claimId } }))).Item ?? null;
    },

    /** One chat per student per post; a declined chat may be started again. */
    async createClaim(claim) {
      try {
        await db.send(new PutCommand({
          TableName: claimsTable, Item: claim,
          ConditionExpression: 'attribute_not_exists(claimId) OR #status = :declined',
          ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':declined': 'DECLINED' },
        }));
      } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') throw new ConflictError('You already have a conversation about this post. Open it from Messages.');
        throw error;
      }
    },

    async claimsForItem(itemId) {
      return queryAll({ TableName: claimsTable, KeyConditionExpression: 'itemId = :item', ExpressionAttributeValues: { ':item': itemId }, ScanIndexForward: false }, 200);
    },

    async claimsForUser(userId) {
      const byIndex = (IndexName, key) => db.send(new QueryCommand({
        TableName: claimsTable, IndexName, ScanIndexForward: false, Limit: 50,
        KeyConditionExpression: `${key} = :user`, ExpressionAttributeValues: { ':user': userId },
      }));
      const [asOwner, asClaimant] = await Promise.all([byIndex('OwnerIndex', 'ownerId'), byIndex('ClaimantIndex', 'claimantId')]);
      return [...(asOwner.Items ?? []), ...(asClaimant.Items ?? [])];
    },

    async updateClaim(itemId, claimId, set, expect = {}) {
      const update = buildUpdate(set, expect);
      const result = await guarded(db.send(new UpdateCommand({ TableName: claimsTable, Key: { itemId, claimId }, ...update, ReturnValues: 'ALL_NEW' })));
      return result.Attributes;
    },

    /** Appends chat messages (capped) while the chat is still open. */
    async appendMessages(itemId, claimId, entries, set = {}, maxMessages = 100) {
      const update = buildUpdate(set, { status: { not: 'DECLINED' } });
      const result = await guarded(db.send(new UpdateCommand({
        TableName: claimsTable, Key: { itemId, claimId }, ReturnValues: 'ALL_NEW',
        UpdateExpression: `${update.UpdateExpression ? `${update.UpdateExpression}, ` : 'SET '}messages = list_append(messages, :entries)`,
        ConditionExpression: `${update.ConditionExpression} AND size(messages) < :max`,
        ExpressionAttributeNames: update.ExpressionAttributeNames,
        ExpressionAttributeValues: { ...update.ExpressionAttributeValues, ':entries': entries, ':max': maxMessages },
      })));
      return result.Attributes;
    },

    /**
     * Owner confirms a handoff: closes the chat and resolves the post (and the student's
     * linked post, if any) in one all-or-nothing transaction.
     */
    async resolveHandoff({ claim, decision, entries, at }) {
      const claimUpdate = buildUpdate({ ...decision }, { status: 'OPEN' });
      claimUpdate.UpdateExpression += ', messages = list_append(messages, :entries)';
      claimUpdate.ExpressionAttributeValues[':entries'] = entries;
      const resolve = (itemId, ownerId) => {
        const update = buildUpdate({ status: 'RESOLVED', resolvedAt: at, updatedAt: at, resolutionClaimId: claim.claimId }, { status: 'ACTIVE', ownerId });
        return { Update: { TableName: itemsTable, Key: { itemId }, ...update } };
      };
      const transactItems = [
        { Update: { TableName: claimsTable, Key: { itemId: claim.itemId, claimId: claim.claimId }, ...claimUpdate } },
        resolve(claim.itemId, claim.ownerId),
      ];
      if (claim.matchedItemId) transactItems.push(resolve(claim.matchedItemId, claim.claimantId));
      await guarded(db.send(new TransactWriteCommand({ TransactItems: transactItems })));
    },
  };
}

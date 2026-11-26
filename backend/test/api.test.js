// End-to-end tests of the API router against the in-memory store: real user journeys,
// permission rules and the guarantee that private fields never reach the browser.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createMemoryStore } from './memory-store.js';

const USERS = {
  asha: { sub: 'user-asha', name: 'Asha Verma', email: 'asha@thapar.edu' },
  bilal: { sub: 'user-bilal', name: 'Bilal Khan', email: 'bilal@thapar.edu' },
  chen: { sub: 'user-chen', name: 'Chen Li', email: 'chen@thapar.edu' },
  dev: { sub: 'user-dev', name: 'Dev Rao', email: 'dev@thapar.edu' },
  mod: { sub: 'user-mod', name: 'Mona Admin', email: 'mod@thapar.edu', 'cognito:groups': '[admins]' },
};
const PRIVATE = ['user-asha', 'user-bilal', 'user-chen', '@thapar.edu', 'visualHash', 'reportedBy', 'ownerId', 'claimantId'];

let store;
let call;
let clock;
let ids;

beforeEach(() => {
  store = createMemoryStore();
  clock = new Date('2026-11-26T10:00:00Z');
  ids = 0;
  const app = createApp({
    store,
    campusId: 'campus',
    clock: () => new Date(clock),
    newId: () => `item-${(ids += 1)}`,
    log: { info() {}, warn() {}, error() {} },
    files: {
      uploadUrl: async key => `https://s3.test/${key}?put`,
      viewUrl: async key => `https://s3.test/${key}?get`,
      size: async () => 1234,
      remove: async () => {},
    },
    analyzer: { queue: async () => {} },
  });
  call = async (who, routeKey, { params, body, query } = {}) => {
    const claims = who && USERS[who];
    const response = await app({
      routeKey,
      requestContext: claims ? { authorizer: { jwt: { claims } } } : {},
      pathParameters: params,
      queryStringParameters: query,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.statusCode, body: JSON.parse(response.body), raw: response.body };
  };
});

const post = async (who, body) => (await call(who, 'POST /items', { body })).body.item;
const lostBottle = { itemType: 'LOST', title: 'Blue steel bottle', category: 'bottles', location: 'Central Library', description: 'Mountain sticker' };
const foundBottle = { itemType: 'FOUND', title: 'Steel bottle', category: 'bottles', location: 'Library', handover: 'library', file: { contentType: 'image/jpeg', size: 2000 } };

function assertPrivate(raw) {
  for (const secret of PRIVATE) assert.ok(!raw.includes(secret), `response leaked "${secret}"`);
}

test('requests need a signed-in user, except public stats; unknown routes 404', async () => {
  assert.equal((await call(null, 'GET /items')).status, 401);
  assert.equal((await call(null, 'GET /stats')).status, 200);
  assert.equal((await call('asha', 'GET /nope')).status, 404);
});

test('a found post with a photo goes through upload, analysis and onto the board', async () => {
  const created = await call('bilal', 'POST /items', { body: foundBottle });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.status, 'AWAITING_UPLOAD');
  assert.equal(created.body.item.ownerLabel, 'Bilal K.');
  assert.match(created.body.uploadUrl, /uploads\/item-1\/photo\?put/);
  assertPrivate(created.raw);

  const itemId = created.body.item.itemId;
  assert.equal((await call('asha', 'POST /items/{itemId}/complete', { params: { itemId } })).status, 403);
  assert.equal((await call('bilal', 'POST /items/{itemId}/complete', { params: { itemId } })).status, 202);
  assert.equal(store.itemMap.get(itemId).status, 'PROCESSING');

  store.itemMap.get(itemId).status = 'ACTIVE'; // what the worker does
  const board = await call('asha', 'GET /items');
  assert.equal(board.body.items.length, 1);
  assert.equal(board.body.items[0].mine, false);
  assert.match(board.body.items[0].imageUrl, /\?get$/);
  assertPrivate(board.raw);
  assert.ok(store.itemMap.get(itemId).expiresAt > clock.getTime() / 1000 + 89 * 86_400, '90-day TTL set');
});

test('owners can edit and resolve their posts; others cannot', async () => {
  const item = await post('asha', lostBottle);
  const params = { itemId: item.itemId };
  assert.equal((await call('bilal', 'PATCH /items/{itemId}', { params, body: { title: 'Mine now' } })).status, 403);

  const edited = await call('asha', 'PATCH /items/{itemId}', { params, body: { location: 'Sports complex', category: 'other' } });
  assert.equal(edited.body.item.location, 'Sports complex');
  assert.equal(store.itemMap.get(item.itemId).matchKey, 'LOST#other');
  assert.ok(edited.body.item.editedAt);

  const resolved = await call('asha', 'PATCH /items/{itemId}', { params, body: { status: 'RESOLVED' } });
  assert.equal(resolved.body.item.status, 'RESOLVED');
  assert.equal((await call('asha', 'PATCH /items/{itemId}', { params, body: { title: 'too late' } })).status, 409);
});

test('matches rank the opposite type and skip your own posts', async () => {
  const lost = await post('asha', lostBottle);
  const found = await post('bilal', foundBottle);
  store.itemMap.get(found.itemId).status = 'ACTIVE';
  await post('asha', { ...foundBottle, title: 'My own find' }); // same owner: never suggested to her

  const result = await call('asha', 'GET /items/{itemId}/matches', { params: { itemId: lost.itemId } });
  assert.deepEqual(result.body.matches.map(match => match.itemId), [found.itemId]);
  assert.ok(result.body.matches[0].sameLocation);
  assertPrivate(result.raw);
});

test('"This is mine" chat: messages, unread counts, privacy and a confirmed handoff', async () => {
  const found = await post('bilal', foundBottle);
  const lost = await post('asha', lostBottle);
  store.itemMap.get(found.itemId).status = 'ACTIVE';
  const params = { itemId: found.itemId };

  assert.equal((await call('bilal', 'POST /items/{itemId}/claims', { params, body: { message: 'my own post' } })).status, 400);
  assert.equal((await call('asha', 'POST /items/{itemId}/claims', { params, body: { message: 'short' } })).status, 400);
  const started = await call('asha', 'POST /items/{itemId}/claims', { params, body: { message: 'Mine, sticker on the cap', contact: '98xxxx', matchedItemId: lost.itemId } });
  assert.equal(started.status, 201);
  assert.equal(started.body.claim.role, 'claimant');
  assertPrivate(started.raw);
  assert.equal((await call('asha', 'POST /items/{itemId}/claims', { params, body: { message: 'Mine, sticker again' } })).status, 409);

  const claimId = started.body.claim.claimId;
  const chat = { itemId: found.itemId, claimId };
  assert.equal((await call('bilal', 'GET /inbox')).body.unread, 1);
  assert.equal((await call('chen', 'GET /inbox')).body.threads.length, 0);
  assert.equal((await call('chen', 'POST /items/{itemId}/claims/{claimId}/messages', { params: chat, body: { text: 'hi' } })).status, 404);
  assert.deepEqual((await call('chen', 'GET /items/{itemId}/claims', { params })).body.claims, []);

  clock = new Date(clock.getTime() + 60_000);
  const reply = await call('bilal', 'POST /items/{itemId}/claims/{claimId}/messages', { params: chat, body: { text: 'Which colour is the sticker?' } });
  assert.deepEqual(reply.body.claim.messages.map(message => message.from), ['claimant', 'owner']);
  assert.equal((await call('bilal', 'GET /inbox')).body.unread, 0);
  assert.equal((await call('asha', 'GET /inbox')).body.unread, 1);
  await call('asha', 'PATCH /items/{itemId}/claims/{claimId}', { params: chat, body: { seen: true } });
  assert.equal((await call('asha', 'GET /inbox')).body.unread, 0);

  assert.equal((await call('asha', 'PATCH /items/{itemId}/claims/{claimId}', { params: chat, body: { status: 'ACCEPTED' } })).status, 403);
  const accepted = await call('bilal', 'PATCH /items/{itemId}/claims/{claimId}', { params: chat, body: { status: 'ACCEPTED', reply: 'Collect at 4 pm' } });
  assert.equal(accepted.body.claim.status, 'ACCEPTED');
  assert.equal(store.itemMap.get(found.itemId).status, 'RESOLVED');
  assert.equal(store.itemMap.get(lost.itemId).status, 'RESOLVED', 'linked lost post closes too');
  assert.ok(store.itemMap.get(found.itemId).resolvedAt);
});

test('a declined chat is closed and can be restarted', async () => {
  const found = await post('bilal', foundBottle);
  store.itemMap.get(found.itemId).status = 'ACTIVE';
  const params = { itemId: found.itemId };
  const { claimId } = (await call('asha', 'POST /items/{itemId}/claims', { params, body: { message: 'This looks like mine' } })).body.claim;
  const chat = { itemId: found.itemId, claimId };
  const declined = await call('bilal', 'PATCH /items/{itemId}/claims/{claimId}', { params: chat, body: { status: 'DECLINED', reply: 'Mine has no dent' } });
  assert.deepEqual(declined.body.claim.messages.slice(-2).map(message => message.from), ['owner', 'system']);
  assert.equal((await call('asha', 'POST /items/{itemId}/claims/{claimId}/messages', { params: chat, body: { text: 'please?' } })).status, 409);
  assert.equal((await call('asha', 'POST /items/{itemId}/claims', { params, body: { message: 'Second try, new detail' } })).status, 201);
});

test('three reports hide a post; moderators review, restore or remove it', async () => {
  const item = await post('asha', lostBottle);
  const params = { itemId: item.itemId };
  assert.equal((await call('asha', 'POST /items/{itemId}/report', { params, body: { reason: 'spam' } })).status, 400);
  assert.equal((await call('bilal', 'POST /items/{itemId}/report', { params, body: { reason: 'nonsense' } })).status, 400);
  assert.equal((await call('bilal', 'POST /items/{itemId}/report', { params, body: { reason: 'spam' } })).status, 200);
  assert.equal((await call('bilal', 'POST /items/{itemId}/report', { params, body: { reason: 'spam' } })).status, 409);
  await call('chen', 'POST /items/{itemId}/report', { params, body: { reason: 'scam' } });
  await call('dev', 'POST /items/{itemId}/report', { params, body: { reason: 'spam' } });
  assert.equal(store.itemMap.get(item.itemId).status, 'HIDDEN');
  assert.equal((await call('bilal', 'GET /items')).body.items.length, 0, 'hidden from others');
  assert.equal((await call('asha', 'GET /items')).body.items.length, 1, 'owner still sees it');

  assert.equal((await call('bilal', 'GET /admin/overview')).status, 403);
  const overview = await call('mod', 'GET /admin/overview');
  assert.equal(overview.body.flagged.length, 1);
  assert.equal(overview.body.flagged[0].reportCount, 3);
  assertPrivate(overview.raw);

  await call('mod', 'POST /admin/items/{itemId}/moderate', { params, body: { action: 'restore' } });
  assert.equal(store.itemMap.get(item.itemId).status, 'ACTIVE');
  assert.equal(store.itemMap.get(item.itemId).reportCount, 0);
  await call('mod', 'POST /admin/items/{itemId}/moderate', { params, body: { action: 'remove' } });
  assert.equal(store.itemMap.get(item.itemId).status, 'REMOVED');
  assert.equal((await call('asha', 'GET /items/{itemId}', { params })).status, 404);
});

test('owners and moderators can delete; others cannot', async () => {
  const item = await post('asha', lostBottle);
  const params = { itemId: item.itemId };
  assert.equal((await call('bilal', 'DELETE /items/{itemId}', { params })).status, 403);
  assert.equal((await call('asha', 'DELETE /items/{itemId}', { params })).status, 200);
  assert.equal(store.itemMap.get(item.itemId).removedBy, 'owner');
});

test('the board pages with a cursor', async () => {
  for (let i = 0; i < 65; i += 1) {
    clock = new Date(clock.getTime() + 1000);
    await post('asha', { ...lostBottle, title: `Bottle ${i}` });
  }
  const first = await call('bilal', 'GET /items');
  assert.equal(first.body.items.length, 60);
  assert.equal(first.body.items[0].title, 'Bottle 64', 'newest first');
  const second = await call('bilal', 'GET /items', { query: { cursor: first.body.cursor } });
  assert.equal(second.body.items.length, 5);
  assert.equal(second.body.cursor, null);
});

test('bad JSON is a 400, not a crash', async () => {
  const app = createApp({ store, campusId: 'campus', log: { info() {}, warn() {}, error() {} } });
  const response = await app({ routeKey: 'POST /items', requestContext: { authorizer: { jwt: { claims: USERS.asha } } }, body: '{oops' });
  assert.equal(response.statusCode, 400);
});

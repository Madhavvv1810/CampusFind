#!/usr/bin/env node
// Live end-to-end check of a deployed stack: two temporary students post, match, chat and
// complete a handoff through the real API, S3 and image worker. Cleans up after itself.
//
//   AWS_REGION=us-east-1 node scripts/smoke-test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stackOutputs, signInAs, deleteUsers, createPost, waitFor, apiClient } from './lib/tools.mjs';

const DOMAIN = process.env.SEED_EMAIL_DOMAIN ?? 'thapar.edu';
const PREFIX = 'campusfind-smoke.';
const steps = [];
const step = async (name, fn) => {
  const started = Date.now();
  await fn();
  steps.push(`✓ ${name} (${Date.now() - started} ms)`);
  console.log(steps.at(-1));
};

const outputs = await stackOutputs();
const anonymous = apiClient(outputs.ApiUrl);
let finder;
let owner;
let found;
let lost;
let claimId;

try {
  await step('public stats are reachable without signing in', async () => {
    const { status, data } = await anonymous.call('GET', '/stats');
    assert.equal(status, 200);
    assert.ok(typeof data.stats.total === 'number');
  });
  await step('API rejects requests without a valid token', async () => {
    assert.equal((await anonymous.call('GET', '/items')).status, 401);
    assert.equal((await apiClient(outputs.ApiUrl, 'not.a.jwt').call('GET', '/items')).status, 401);
  });
  await step('two students sign in through Cognito', async () => {
    finder = await signInAs(outputs, { email: `${PREFIX}finder@${DOMAIN}`, name: 'Smoke Finder' });
    owner = await signInAs(outputs, { email: `${PREFIX}owner@${DOMAIN}`, name: 'Smoke Owner' });
  });
  await step('finder posts a found item; photo goes to S3 and the worker publishes it', async () => {
    const photo = await readFile(new URL('./seed-photos/silver-watch.jpg', import.meta.url));
    found = await createPost(finder, { itemType: 'FOUND', title: 'Smoke test silver watch', category: 'other', location: 'Smoke test gym', handover: 'security' }, photo);
    const live = await waitFor(async () => {
      const { item } = await finder.ok('GET', `/items/${found.itemId}`);
      return item.status === 'ACTIVE' && item;
    });
    assert.ok(live.imageUrl.includes('X-Amz-Signature'), 'photo served through a presigned URL');
    assert.equal(live.ownerLabel, 'Smoke F.');
  });
  await step('owner posts the lost item and gets the found one as a match', async () => {
    lost = await createPost(owner, { itemType: 'LOST', title: 'Smoke test silver watch', category: 'other', location: 'Smoke test gym' });
    const { matches } = await owner.ok('GET', `/items/${lost.itemId}/matches`);
    assert.equal(matches[0]?.itemId, found.itemId);
    assert.ok(matches[0].score >= 80);
  });
  await step('"This is mine" chat: message, reply, unread counts', async () => {
    ({ claim: { claimId } } = await owner.ok('POST', `/items/${found.itemId}/claims`, { message: 'Smoke test: that is my watch', matchedItemId: lost.itemId }));
    assert.equal((await finder.ok('GET', '/inbox')).unread, 1);
    await finder.ok('POST', `/items/${found.itemId}/claims/${claimId}/messages`, { text: 'Smoke test reply' });
    assert.equal((await owner.ok('GET', '/inbox')).unread, 1);
  });
  await step('handoff resolves both posts in one transaction', async () => {
    await finder.ok('PATCH', `/items/${found.itemId}/claims/${claimId}`, { status: 'ACCEPTED' });
    assert.equal((await finder.ok('GET', `/items/${found.itemId}`)).item.status, 'RESOLVED');
    assert.equal((await owner.ok('GET', `/items/${lost.itemId}`)).item.status, 'RESOLVED');
  });
  await step('non-moderators cannot open the admin dashboard', async () => {
    assert.equal((await owner.call('GET', '/admin/overview')).status, 403);
  });
} finally {
  for (const [api, post] of [[finder, found], [owner, lost]]) if (api && post) await api.call('DELETE', `/items/${post.itemId}`);
  const removed = await deleteUsers(outputs, PREFIX);
  console.log(`cleaned up ${removed} temporary users`);
}
console.log(`\nSmoke test passed: ${steps.length} checks against ${outputs.ApiUrl}`);

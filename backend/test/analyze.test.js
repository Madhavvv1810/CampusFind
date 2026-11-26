// The image worker: labels on success, graceful fallback when Rekognition is not permitted,
// and a retryable failure otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzer } from '../src/analyze.js';
import { createMemoryStore } from './memory-store.js';

const quiet = { info() {}, warn() {}, error() {} };
const photoPost = () => createMemoryStore({ items: [{ itemId: 'p1', imageKey: 'uploads/p1/photo', status: 'PROCESSING' }] });
const rekognition = behaviour => ({ send: async () => behaviour() });

test('saves Rekognition labels and publishes the post', async () => {
  const store = photoPost();
  await createAnalyzer({ store, bucket: 'b', log: quiet, rekognition: rekognition(() => ({ Labels: [{ Name: 'Bottle' }, { Name: 'Steel' }] })) })({ itemId: 'p1' });
  const item = store.itemMap.get('p1');
  assert.equal(item.status, 'ACTIVE');
  assert.deepEqual(item.labels, ['Bottle', 'Steel']);
  assert.equal(item.labelSource, 'rekognition');
});

test('publishes without labels when the account denies Rekognition', async () => {
  const store = photoPost();
  const denied = () => { throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' }); };
  await createAnalyzer({ store, bucket: 'b', log: quiet, rekognition: rekognition(denied) })({ itemId: 'p1' });
  assert.equal(store.itemMap.get('p1').status, 'ACTIVE');
  assert.equal(store.itemMap.get('p1').labelSource, 'unavailable');
});

test('marks the post failed and rethrows on other errors so Lambda retries', async () => {
  const store = photoPost();
  const broken = () => { throw Object.assign(new Error('boom'), { name: 'ThrottlingException' }); };
  await assert.rejects(createAnalyzer({ store, bucket: 'b', log: quiet, rekognition: rekognition(broken) })({ itemId: 'p1' }));
  assert.equal(store.itemMap.get('p1').status, 'PROCESSING_FAILED');
});

test('ignores posts that were removed or are already live', async () => {
  const store = createMemoryStore({ items: [{ itemId: 'gone', imageKey: 'k', status: 'REMOVED' }] });
  let called = false;
  await createAnalyzer({ store, bucket: 'b', log: quiet, rekognition: rekognition(() => { called = true; }) })({ itemId: 'gone' });
  assert.equal(called, false);
});

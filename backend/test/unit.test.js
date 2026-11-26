// Unit tests for the pure modules: validation, identity, matching, stats and the DynamoDB update builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNewPost, validateEdit, dateOrNull } from '../src/validation.js';
import { displayName, parseGroups, userFromEvent } from '../src/identity.js';
import { textSimilarity, photoSimilarity, samePlace, scoreMatch, rankMatches } from '../src/matching.js';
import { campusStats } from '../src/stats.js';
import { buildUpdate } from '../src/aws/store.js';
import { isAllowedEmail } from '../src/presignup.js';
import { HttpError } from '../src/http.js';

const rejects400 = fn => assert.throws(fn, error => error instanceof HttpError && error.status === 400);

test('lost posts need title, category and place; found posts need a photo', () => {
  rejects400(() => validateNewPost({ itemType: 'LOST', title: 'Keys' }));
  rejects400(() => validateNewPost({ itemType: 'FOUND', title: 'Keys', category: 'keys' }));
  rejects400(() => validateNewPost({ itemType: 'MAYBE' }));
  rejects400(() => validateNewPost({ itemType: 'LOST', title: 'x', category: 'spaceships', location: 'Library' }));
  const lost = validateNewPost({ itemType: 'lost', title: '  Blue   bottle ', category: 'bottles', location: 'Library' });
  assert.equal(lost.itemType, 'LOST');
  assert.equal(lost.fields.title, 'Blue bottle');
});

test('photos must be JPG/PNG up to 5 MB; handover only applies to found items', () => {
  const file = size => ({ contentType: 'image/jpeg', size });
  rejects400(() => validateNewPost({ itemType: 'FOUND', category: 'keys', file: file(6 * 1024 * 1024) }));
  rejects400(() => validateNewPost({ itemType: 'FOUND', category: 'keys', file: { contentType: 'image/gif', size: 10 } }));
  rejects400(() => validateNewPost({ itemType: 'LOST', title: 'a', category: 'keys', location: 'Gym', handover: 'security' }));
  const found = validateNewPost({ itemType: 'FOUND', category: 'keys', handover: 'security', file: file(1000), visualHash: 'ABCDEF0123456789' });
  assert.equal(found.fields.handover, 'security');
  assert.equal(found.visualHash, 'abcdef0123456789');
});

test('dates must be real and not in the future', () => {
  const today = new Date('2026-11-26T10:00:00Z');
  assert.equal(dateOrNull('2026-11-20', today), '2026-11-20');
  assert.equal(dateOrNull('2026-02-30', today), null);
  assert.equal(dateOrNull('2027-01-01', today), null);
  assert.equal(dateOrNull('yesterday', today), null);
});

test('edits only change provided fields and keep the post complete', () => {
  const item = { itemType: 'LOST', title: 'Keys', category: 'keys', location: 'Gym', hasPhoto: false };
  assert.deepEqual(validateEdit({ location: 'Library' }, item), { location: 'Library' });
  rejects400(() => validateEdit({ title: '' }, item));
  rejects400(() => validateEdit({}, item));
});

test('display names never reveal surnames or emails', () => {
  assert.equal(displayName({ name: 'Madhav Singla' }), 'Madhav S.');
  assert.equal(displayName({ name: 'Asha' }), 'Asha');
  assert.equal(displayName({ email: 'msingla_be24@thapar.edu' }), 'msingla_be24');
  assert.deepEqual(parseGroups('[admins staff]'), ['admins', 'staff']);
  assert.deepEqual(parseGroups(['admins']), ['admins']);
  assert.equal(userFromEvent({}), null);
  assert.equal(userFromEvent({ requestContext: { authorizer: { jwt: { claims: { sub: 'u1', 'cognito:groups': '[admins]' } } } } }).isAdmin, true);
});

test('sign-up is limited to the college domain', () => {
  assert.equal(isAllowedEmail('a@thapar.edu', 'thapar.edu'), true);
  assert.equal(isAllowedEmail('a@THAPAR.EDU', 'thapar.edu'), true);
  assert.equal(isAllowedEmail('a@gmail.com', 'thapar.edu'), false);
  assert.equal(isAllowedEmail('a@thapar.edu.evil.com', 'thapar.edu'), false);
  assert.equal(isAllowedEmail('a@gmail.com', ''), true);
});

test('matching signals', () => {
  assert.equal(textSimilarity('blue steel bottle', 'Blue bottle, steel'), 1);
  assert.equal(textSimilarity('', ''), 0);
  assert.equal(photoSimilarity('0000000000000000', '0000000000000000').label, 'Very similar photo');
  assert.equal(photoSimilarity('0000000000000000', 'ffffffffffffffff'), null);
  assert.equal(photoSimilarity('bad', '0000000000000000'), null);
  assert.equal(samePlace('Central Library, ground floor', 'central library'), true);
  assert.equal(samePlace('Gym', 'Gymkhana'), false);
});

test('rankMatches prefers the strongest opposite-type candidate and drops weak ones', () => {
  const lost = { itemId: 'l', itemType: 'LOST', status: 'ACTIVE', category: 'bottles', title: 'Blue steel bottle', location: 'Library', labels: ['Bottle'] };
  const strong = { itemId: 'f1', itemType: 'FOUND', status: 'ACTIVE', category: 'bottles', title: 'steel bottle blue', location: 'Central library', labels: ['Bottle'] };
  const weak = { itemId: 'f2', itemType: 'FOUND', status: 'ACTIVE', category: 'bottles', title: 'flask', location: 'Gym' };
  const otherType = { ...strong, itemId: 'l2', itemType: 'LOST' };
  const closed = { ...strong, itemId: 'f3', status: 'RESOLVED' };
  const ranked = rankMatches(lost, [weak, strong, otherType, closed]);
  assert.deepEqual(ranked.map(match => match.itemId), ['f1', 'f2']);
  assert.equal(ranked[0].score, scoreMatch(lost, strong).score);
  assert.ok(ranked[0].score >= 90);
});

test('campus stats: totals, return rate, median time to return, daily series', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  const at = hoursAgo => new Date(now - hoursAgo * 3_600_000).toISOString();
  const items = [
    { itemType: 'LOST', status: 'ACTIVE', category: 'keys', createdAt: at(5) },
    { itemType: 'FOUND', status: 'ACTIVE', category: 'keys', createdAt: at(30) },
    { itemType: 'FOUND', status: 'RESOLVED', category: 'bottles', createdAt: at(50), resolvedAt: at(40) },
    { itemType: 'LOST', status: 'RESOLVED', category: 'bottles', createdAt: at(60), resolvedAt: at(30) },
    { itemType: 'LOST', status: 'REMOVED', category: 'keys', createdAt: at(1) },
  ];
  const stats = campusStats(items, now);
  assert.equal(stats.total, 4);
  assert.equal(stats.openLost, 1);
  assert.equal(stats.openFound, 1);
  assert.equal(stats.returned, 2);
  assert.equal(stats.returnRate, 50);
  assert.equal(stats.medianHoursToReturn, 20);
  assert.equal(stats.daily.length, 14);
  assert.equal(stats.daily.reduce((sum, day) => sum + day.posts, 0), 4);
  assert.equal(stats.byCategory[0].category, 'keys');
  assert.equal(campusStats([], now).medianHoursToReturn, null);
});

test('buildUpdate turns plain objects into a DynamoDB update', () => {
  const update = buildUpdate({ status: 'ACTIVE', processingError: null }, { status: ['PROCESSING', 'FAILED'], ownerId: 'u', removedAt: { exists: false }, kind: { not: 'X' } });
  assert.equal(update.UpdateExpression, 'SET #status = :set_status REMOVE #processingError');
  assert.equal(update.ConditionExpression, '#status IN (:in_status_0, :in_status_1) AND #ownerId = :eq_ownerId AND attribute_not_exists(#removedAt) AND #kind <> :not_kind');
  assert.deepEqual(update.ExpressionAttributeValues, { ':set_status': 'ACTIVE', ':in_status_0': 'PROCESSING', ':in_status_1': 'FAILED', ':eq_ownerId': 'u', ':not_kind': 'X' });
});

test('black earbuds never match a calculator; colour and place matter', () => {
  const lost = { itemId: 'l', itemType: 'LOST', status: 'ACTIVE', category: 'electronics', title: 'buds black colour', description: 'black Samsung', location: 'Cafeteria' };
  const calculator = { itemId: 'c', itemType: 'FOUND', status: 'ACTIVE', category: 'electronics', title: 'Casio fx-991 calculator', location: 'Computer centre' };
  const whiteBuds = { itemId: 'w', itemType: 'FOUND', status: 'ACTIVE', category: 'electronics', title: 'White earbuds case', location: 'Library' };
  const blackBuds = { itemId: 'b', itemType: 'FOUND', status: 'ACTIVE', category: 'electronics', title: 'Black earphones', location: 'Cafeteria' };
  const ranked = rankMatches(lost, [calculator, whiteBuds, blackBuds]);
  assert.deepEqual(ranked.map(match => match.itemId), ['b', 'w']);
  assert.equal(ranked[0].sameType, 'earbuds');
  assert.equal(ranked[0].sameColour, 'black');
  assert.ok(ranked[1].colourConflict);
});

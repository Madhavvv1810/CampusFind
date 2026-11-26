#!/usr/bin/env node
// Fills a deployed CampusFind with realistic sample activity: eight sample students, lost and
// found posts with photos, private chats and completed handoffs, spread over the last two weeks.
// Everything goes through the real API (and S3 uploads); only the timestamps are backdated.
//
//   AWS_REGION=us-east-1 node scripts/seed.mjs           # add sample data
//   AWS_REGION=us-east-1 node scripts/seed.mjs --clean   # remove it again
import { readFile } from 'node:fs/promises';
import { stackOutputs, signInAs, deleteUsers, createPost, waitFor, dynamo, region } from './lib/tools.mjs';

const DOMAIN = process.env.SEED_EMAIL_DOMAIN ?? 'thapar.edu';
const PREFIX = 'campusfind-sample.';
const HOUR = 3_600_000;

const STUDENTS = {
  priya: 'Priya Sharma', arjun: 'Arjun Mehta', neha: 'Neha Kapoor', rohan: 'Rohan Gupta',
  isha: 'Isha Patel', kabir: 'Kabir Joshi', ananya: 'Ananya Rao', vikram: 'Vikram Singh',
};

// [owner, hoursAgo, post fields, photo file or null]
const POSTS = [
  ['arjun', 4, { itemType: 'FOUND', title: 'Keys with a green "ROOM 12" tag', category: 'keys', location: 'Lecture theatre complex', handover: 'security', description: 'Two keys on a ring. Found under a seat in LT-3 after the 2 pm class.' }, 'keys-green-tag'],
  ['neha', 7, { itemType: 'LOST', title: 'White earbuds case', category: 'electronics', location: 'Cafeteria', description: 'Small scratch on the lid. Left it on a table near the window around lunch.' }, null],
  ['vikram', 6, { itemType: 'FOUND', title: 'White earbuds case', category: 'electronics', location: 'Cafeteria', handover: 'with-finder', description: 'Found on a window-side table.' }, 'white-earbuds-case'],
  ['priya', 30, { itemType: 'LOST', title: 'Blue steel water bottle', category: 'bottles', location: 'Central Library', description: 'Dark blue with a white mountain sticker near the cap.' }, null],
  ['rohan', 26, { itemType: 'FOUND', title: 'Blue bottle with a mountain sticker', category: 'bottles', location: 'Central Library, reading hall', handover: 'library', description: 'Left on the second-floor tables.' }, 'blue-steel-bottle'],
  ['kabir', 52, { itemType: 'FOUND', title: 'Casio fx-991 calculator', category: 'electronics', location: 'Computer centre', handover: 'department', description: 'Black scientific calculator, left in lab 2 after the quiz.' }, 'black-calculator'],
  ['isha', 75, { itemType: 'LOST', title: 'Grey zip-up hoodie', category: 'clothing', location: 'Sports complex', description: 'Grey hoodie, size M, left on the bench by the basketball court.' }, null],
  ['ananya', 70, { itemType: 'FOUND', title: 'Grey hoodie', category: 'clothing', location: 'Sports complex', handover: 'security', description: 'Found on the basketball court bench.' }, 'grey-hoodie'],
  ['vikram', 96, { itemType: 'FOUND', title: 'Student ID card', category: 'id-cards', location: 'Main gate', handover: 'security', description: 'Found near the main gate. Handed to the security office.' }, 'student-id-card'],
  ['priya', 120, { itemType: 'FOUND', title: 'Black folding umbrella', category: 'other', location: 'Hostel mess', handover: 'with-finder', description: 'Wooden handle. Left by the mess entrance.' }, 'black-umbrella'],
  ['arjun', 150, { itemType: 'LOST', title: 'Physics notebook (Sem 3)', category: 'books', location: 'Academic block', description: 'Blue spiral notebook with all my mid-sem notes.' }, null],
  ['neha', 140, { itemType: 'FOUND', title: 'Blue spiral notebook "PHYSICS"', category: 'books', location: 'Academic block, room 204', handover: 'department', description: 'Found in room 204.' }, 'physics-notebook'],
  ['rohan', 190, { itemType: 'LOST', title: 'Laptop charger (65 W, white)', category: 'electronics', location: 'Central Library', description: 'White USB-C charger, probably left plugged in near the study pods.' }, 'laptop-charger'],
  ['isha', 230, { itemType: 'FOUND', title: 'Black backpack', category: 'bags', location: 'Central Library', handover: 'library', description: 'No name tag. Contains a pencil case and a lunch box.' }, 'black-backpack'],
  ['kabir', 260, { itemType: 'LOST', title: 'Silver analogue watch', category: 'other', location: 'Gym', description: 'Silver dial, dark strap. Took it off before a workout.' }, 'silver-watch'],
  ['ananya', 300, { itemType: 'LOST', title: 'Brown leather wallet', category: 'other', location: 'Cafeteria', description: 'Has my hostel card inside.' }, null],
];

// Conversations: [post index, from student, message, replies..., outcome?]
const CHATS = [
  { post: 2, from: 'neha', message: 'That looks like mine! Does it have a small scratch on the lid?', replies: [['owner', 'Yes, a little scratch near the hinge. Where should I bring it?'], ['claimant', 'Could you leave it at the cafeteria counter? I can pick it up at 5.']] },
  { post: 4, from: 'priya', message: 'This is my bottle, the sticker is a white mountain. Thank you!', linkTo: 3, replies: [['owner', 'Matches! It is at the library help desk.']], outcome: 'ACCEPTED', after: 20 },
  { post: 7, from: 'isha', message: 'My grey hoodie, size M, has a coffee stain on the left cuff.', linkTo: 6, replies: [['owner', 'Yes, there is a stain. Handed it to the security office.']], outcome: 'ACCEPTED', after: 50 },
  { post: 11, from: 'arjun', message: 'That is my physics notebook, my name is inside the back cover.', linkTo: 10, replies: [['owner', 'Found your name. It is at the department office.']], outcome: 'ACCEPTED', after: 120 },
  { post: 0, from: 'kabir', message: 'Hi, I think those are my keys. Is the tag green?', replies: [['owner', 'The tag is green but it says ROOM 12. Is that yours?'], ['claimant', 'No, mine says LAB. Sorry, not mine.']], outcome: 'DECLINED', after: 2 },
];

async function clean(outputs) {
  const removed = await deleteUsers(outputs, PREFIX);
  const db = dynamo.DynamoDBDocumentClient.from(new dynamo.DynamoDBClient({ region }));
  const { Items = [] } = await db.send(new dynamo.QueryCommand({
    TableName: outputs.ItemsTableName, IndexName: 'CampusIndex', KeyConditionExpression: 'campusId = :c', ExpressionAttributeValues: { ':c': 'default-campus' },
  }));
  const samples = Items.filter(item => item.seed === true);
  for (const item of samples) await db.send(new dynamo.UpdateCommand({ TableName: outputs.ItemsTableName, Key: { itemId: item.itemId }, UpdateExpression: 'SET #s = :r', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':r': 'REMOVED' } }));
  console.log(`Removed ${removed} sample students and ${samples.length} sample posts.`);
}

async function seed(outputs) {
  const db = dynamo.DynamoDBDocumentClient.from(new dynamo.DynamoDBClient({ region }));
  const now = Date.now();
  const iso = hoursAgo => new Date(now - hoursAgo * HOUR).toISOString();

  console.log('Signing in sample students…');
  const api = {};
  for (const [key, name] of Object.entries(STUDENTS)) api[key] = await signInAs(outputs, { email: `${PREFIX}${key}@${DOMAIN}`, name });

  console.log('Creating posts…');
  const created = [];
  for (const [owner, hoursAgo, fields, photoName] of POSTS) {
    const photo = photoName ? await readFile(new URL(`./seed-photos/${photoName}.jpg`, import.meta.url)) : null;
    const item = await createPost(api[owner], fields, photo);
    created.push({ ...item, owner, hoursAgo });
    process.stdout.write('.');
  }
  console.log('');

  console.log('Waiting for photo analysis…');
  await waitFor(async () => {
    const { items } = await api.priya.ok('GET', '/items');
    return created.every(post => items.find(item => item.itemId === post.itemId)?.status === 'ACTIVE');
  });

  console.log('Starting conversations…');
  for (const chat of CHATS) {
    const post = created[chat.post];
    const claimant = api[chat.from];
    const { claim } = await claimant.ok('POST', `/items/${post.itemId}/claims`, {
      message: chat.message, ...(chat.linkTo !== undefined ? { matchedItemId: created[chat.linkTo].itemId } : {}),
    });
    for (const [side, text] of chat.replies) {
      const who = side === 'owner' ? api[post.owner] : claimant;
      await who.ok('POST', `/items/${post.itemId}/claims/${claim.claimId}/messages`, { text });
    }
    if (chat.outcome) await api[post.owner].ok('PATCH', `/items/${post.itemId}/claims/${claim.claimId}`, { status: chat.outcome });
    chat.claimId = claim.claimId;
  }

  console.log('Backdating timestamps…');
  for (const post of created) {
    const resolvedChat = CHATS.find(chat => chat.outcome === 'ACCEPTED' && (created[chat.post] === post || (chat.linkTo !== undefined && created[chat.linkTo] === post)));
    const set = { createdAt: iso(post.hoursAgo), seed: true, ...(resolvedChat ? { resolvedAt: iso(created[resolvedChat.post].hoursAgo - resolvedChat.after) } : {}) };
    const names = Object.fromEntries(Object.keys(set).map(key => [`#${key}`, key]));
    const values = Object.fromEntries(Object.entries(set).map(([key, value]) => [`:${key}`, value]));
    await db.send(new dynamo.UpdateCommand({
      TableName: outputs.ItemsTableName, Key: { itemId: post.itemId },
      UpdateExpression: `SET ${Object.keys(set).map(key => `#${key} = :${key}`).join(', ')}`,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values,
    }));
  }
  for (const chat of CHATS) {
    const post = created[chat.post];
    const startedAt = iso(post.hoursAgo - 1);
    const { Item } = await db.send(new dynamo.GetCommand({ TableName: outputs.ClaimsTableName, Key: { itemId: post.itemId, claimId: chat.claimId } }));
    const messages = Item.messages.map((message, index) => ({ ...message, at: iso(post.hoursAgo - 1 - index * 0.4) }));
    const updatedAt = messages.at(-1).at;
    await db.send(new dynamo.UpdateCommand({
      TableName: outputs.ClaimsTableName, Key: { itemId: post.itemId, claimId: chat.claimId },
      UpdateExpression: 'SET createdAt = :c, updatedAt = :u, messages = :m, ownerSeenAt = :u, claimantSeenAt = :u',
      ExpressionAttributeValues: { ':c': startedAt, ':u': updatedAt, ':m': messages },
    }));
  }

  const { stats } = await api.priya.ok('GET', '/stats');
  console.log(`Done: ${created.length} posts, ${CHATS.length} chats. Board now shows ${stats.openLost} open lost, ${stats.openFound} open found, ${stats.returned} returned.`);
}

const outputs = await stackOutputs();
await (process.argv.includes('--clean') ? clean(outputs) : seed(outputs));

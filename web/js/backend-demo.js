// In-browser demo backend with the same methods as backend-cloud.js. Data lives in localStorage,
// photos in IndexedDB, and simulated students reply to chats so the full flow can be shown offline.
import { rankMatches } from './matching.js';
import { storage, uid, CATEGORIES, itemTitle } from './util.js';

const ITEMS_KEY = 'campusfind-demo-items-v3';
const CHATS_KEY = 'campusfind-demo-chats-v3';
const ME = 'demo-you';
const HOUR = 3_600_000;

const ago = hours => new Date(Date.now() - hours * HOUR).toISOString();
const day = hours => ago(hours).slice(0, 10);

function seedItems() {
  const post = (itemId, ownerId, ownerLabel, hoursAgo, fields) => ({
    itemId, ownerId, ownerLabel, createdAt: ago(hoursAgo), occurredOn: day(hoursAgo + 2), status: 'ACTIVE', labels: [], hasPhoto: false, ...fields,
  });
  return [
    post('d-lost-bottle', ME, 'You', 3, { itemType: 'LOST', title: 'Blue steel water bottle', category: 'bottles', location: 'Central Library', description: 'Dark blue, white mountain sticker near the cap.' }),
    post('d-found-bottle', 'd-priya', 'Priya S.', 2, { itemType: 'FOUND', title: 'Steel bottle with a mountain sticker', category: 'bottles', location: 'Central Library, reading hall', description: 'Left on the second-floor tables.', handover: 'library' }),
    post('d-found-keys', 'd-arjun', 'Arjun M.', 6, { itemType: 'FOUND', title: 'Keys with a green tag', category: 'keys', location: 'Lecture theatre complex', description: 'Three keys on a ring, green plastic tag.', handover: 'security' }),
    post('d-lost-earbuds', 'd-neha', 'Neha K.', 9, { itemType: 'LOST', title: 'White earbuds case', category: 'electronics', location: 'Cafeteria', description: 'Small scratch on the lid.' }),
    post('d-found-id', 'd-rohan', 'Rohan G.', 20, { itemType: 'FOUND', title: 'Student ID card', category: 'id-cards', location: 'Main gate', description: 'Name partly visible. Handed to security.', handover: 'security' }),
    post('d-lost-hoodie', 'd-isha', 'Isha P.', 30, { itemType: 'LOST', title: 'Grey hoodie', category: 'clothing', location: 'Sports complex', description: 'Grey zip-up, size M.' }),
    post('d-found-notebook', 'd-kabir', 'Kabir J.', 44, { itemType: 'FOUND', title: 'Spiral notebook (Physics)', category: 'books', location: 'Academic block', handover: 'department', status: 'RESOLVED', resolvedAt: ago(30) }),
    post('d-lost-umbrella', 'd-ananya', 'Ananya R.', 70, { itemType: 'LOST', title: 'Black folding umbrella', category: 'other', location: 'Hostel mess', status: 'RESOLVED', resolvedAt: ago(52) }),
  ];
}

function seedChats() {
  const at = ago(1.5);
  return [{
    itemId: 'd-lost-bottle', claimId: 'd-chat-priya', ownerId: ME, claimantId: 'd-priya', claimantLabel: 'Priya S.',
    itemTitle: 'Blue steel water bottle', itemType: 'LOST', matchedItemId: 'd-found-bottle', requestType: 'FOUND_FOR_OWNER',
    status: 'OPEN', createdAt: at, updatedAt: at, claimantSeenAt: at, contact: '',
    messages: [{ from: 'claimant', text: 'I think I found your bottle in the reading hall. Is there a small dent on the bottom?', at }],
  }];
}

let items = storage.get(ITEMS_KEY) ?? seedItems();
let chats = storage.get(CHATS_KEY) ?? seedChats();
const save = () => { storage.set(ITEMS_KEY, items); storage.set(CHATS_KEY, chats); };
save();

// ---- photos in IndexedDB ----
const photoUrls = new Map();
function photoDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('campusfind-demo-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function photoStore(mode, action) {
  const db = await photoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    const request = action(tx.objectStore('photos'));
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function photoUrl(itemId) {
  if (!photoUrls.has(itemId)) {
    const blob = await photoStore('readonly', store => store.get(itemId)).catch(() => null);
    photoUrls.set(itemId, blob ? URL.createObjectURL(blob) : null);
  }
  return photoUrls.get(itemId);
}

// ---- views (same shape as the API) ----
async function view(item) {
  const { ownerId, visualHash, ...visible } = item;
  return { ...visible, mine: ownerId === ME, imageUrl: item.hasPhoto ? await photoUrl(item.itemId) : null };
}
function chatView(chat) {
  const role = chat.ownerId === ME ? 'owner' : chat.claimantId === ME ? 'claimant' : null;
  const last = chat.messages.at(-1);
  const seen = role === 'owner' ? chat.ownerSeenAt : chat.claimantSeenAt;
  const { ownerId, claimantId, ...visible } = chat;
  return { ...visible, role, unread: Boolean(role && last && last.from !== role && (!seen || seen < last.at)) };
}

const find = id => items.find(item => item.itemId === id) ?? (() => { throw new Error('This post no longer exists.'); })();
const findChat = (itemId, claimId) => chats.find(chat => chat.itemId === itemId && chat.claimId === claimId);
const mineOnly = item => { if (item.ownerId !== ME) throw new Error('Only the person who posted this can change it.'); };

// Simulated students answer the demo user's chats.
const REPLIES = {
  FOUND: ['Thanks for reaching out! What colour is it, and is anything written on it?', 'That matches. I left it at the help desk; collect it any time before 6 pm.', 'Glad it found its way back!'],
  LOST: ['Oh wow, thank you! Where exactly did you find it?', 'That is definitely mine. Can we meet at the library entrance at 4 pm?', 'Thank you so much!'],
};
function scheduleReply(chat, notify) {
  const theirs = chat.messages.filter(message => message.from === 'owner').length;
  const script = REPLIES[chat.itemType] ?? REPLIES.FOUND;
  if (chat.claimantId !== ME || theirs >= script.length) return;
  setTimeout(() => {
    const live = findChat(chat.itemId, chat.claimId);
    if (!live || live.status !== 'OPEN') return;
    const at = new Date().toISOString();
    live.messages.push({ from: 'owner', text: script[theirs], at });
    live.updatedAt = at;
    save();
    notify?.();
  }, 2200);
}

export function createDemoBackend({ onChange } = {}) {
  return {
    mode: 'demo',

    async stats() {
      const visible = items.filter(item => item.status !== 'REMOVED');
      const returned = visible.filter(item => item.status === 'RESOLVED');
      const hours = returned.map(item => (Date.parse(item.resolvedAt) - Date.parse(item.createdAt)) / HOUR).sort((a, b) => a - b);
      return {
        total: visible.length,
        openLost: visible.filter(item => item.status === 'ACTIVE' && item.itemType === 'LOST').length,
        openFound: visible.filter(item => item.status === 'ACTIVE' && item.itemType === 'FOUND').length,
        returned: returned.length,
        returnRate: visible.length ? Math.round((returned.length / visible.length) * 100) : 0,
        medianHoursToReturn: hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null,
      };
    },

    async listItems() {
      const visible = items.filter(item => item.status !== 'REMOVED').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { items: await Promise.all(visible.map(view)), cursor: null };
    },
    getItem: async id => view(find(id)),

    async createPost({ fields, photo, visualHash }) {
      const item = {
        itemId: uid(), ownerId: ME, ownerLabel: 'You', createdAt: new Date().toISOString(), labels: [],
        ...fields, hasPhoto: Boolean(photo), ...(visualHash ? { visualHash } : {}), status: photo ? 'PROCESSING' : 'ACTIVE',
      };
      if (photo) await photoStore('readwrite', store => store.put(photo, item.itemId));
      items.unshift(item);
      save();
      if (photo) {
        setTimeout(() => { // stands in for the cloud image worker
          item.status = 'ACTIVE';
          item.labels = [CATEGORIES[item.category], ...String(item.title).split(/\s+/).filter(word => word.length > 3).slice(0, 2)].filter(Boolean);
          save();
          onChange?.();
        }, 1200);
      }
      return view(item);
    },
    async retryPhoto() {},
    async editPost(id, changes) {
      const item = find(id);
      mineOnly(item);
      Object.assign(item, changes, { editedAt: new Date().toISOString() });
      save();
      return view(item);
    },
    async resolvePost(id) {
      const item = find(id);
      mineOnly(item);
      Object.assign(item, { status: 'RESOLVED', resolvedAt: new Date().toISOString() });
      save();
      return view(item);
    },
    async deletePost(id) {
      const item = find(id);
      mineOnly(item);
      item.status = 'REMOVED';
      await photoStore('readwrite', store => store.delete(id)).catch(() => {});
      save();
    },
    async matches(id) {
      const source = find(id);
      const ranked = rankMatches(source, items.filter(item => item.ownerId !== source.ownerId));
      return Promise.all(ranked.map(async match => ({ ...(await view(match)), ...Object.fromEntries(['score', 'sharedLabels', 'sameCategory', 'sameLocation', 'titleOverlap', 'photoSimilarity', 'sameType', 'sameColour', 'colourConflict'].map(key => [key, match[key]])) })));
    },
    async report() { return { message: 'Thanks. In the real app a moderator reviews reported posts.' }; },

    async inbox() {
      const threads = chats.map(chatView).filter(thread => thread.role).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { threads, unread: threads.filter(thread => thread.unread).length };
    },
    chatsFor: async id => chats.filter(chat => chat.itemId === id).map(chatView).filter(chat => chat.role),
    async startChat(id, { message, contact, matchedItemId }) {
      const item = find(id);
      if (item.ownerId === ME) throw new Error('You cannot message your own post.');
      if (chats.some(chat => chat.itemId === id && chat.claimantId === ME && chat.status !== 'DECLINED')) throw new Error('You already have a conversation about this post. Open it from Messages.');
      const at = new Date().toISOString();
      const chat = {
        itemId: id, claimId: uid(), ownerId: item.ownerId, claimantId: ME, claimantLabel: 'You', ownerLabel: item.ownerLabel,
        itemTitle: itemTitle(item), itemType: item.itemType, matchedItemId: matchedItemId || null,
        requestType: item.itemType === 'LOST' ? 'FOUND_FOR_OWNER' : 'OWNER_CLAIM', contact, status: 'OPEN',
        createdAt: at, updatedAt: at, claimantSeenAt: at, messages: [{ from: 'claimant', text: message, at }],
      };
      chats.push(chat);
      save();
      scheduleReply(chat, onChange);
      return chatView(chat);
    },
    async sendMessage(itemId, claimId, text) {
      const chat = findChat(itemId, claimId);
      const role = chatView(chat).role;
      const at = new Date().toISOString();
      chat.messages.push({ from: role, text, at });
      Object.assign(chat, { updatedAt: at, [role === 'owner' ? 'ownerSeenAt' : 'claimantSeenAt']: at });
      save();
      scheduleReply(chat, onChange);
      return chatView(chat);
    },
    async markSeen(itemId, claimId) {
      const chat = findChat(itemId, claimId);
      chat[chatView(chat).role === 'owner' ? 'ownerSeenAt' : 'claimantSeenAt'] = new Date().toISOString();
      save();
    },
    async decide(itemId, claimId, status, reply) {
      const chat = findChat(itemId, claimId);
      const at = new Date().toISOString();
      if (reply) chat.messages.push({ from: 'owner', text: reply, at });
      chat.messages.push({ from: 'system', text: status === 'ACCEPTED' ? 'The owner confirmed the match. The item is marked returned.' : 'The owner marked this as not a match.', at });
      Object.assign(chat, { status, updatedAt: at, ownerSeenAt: at });
      if (status === 'ACCEPTED') {
        for (const id of [chat.itemId, chat.matchedItemId].filter(Boolean)) {
          const item = items.find(candidate => candidate.itemId === id);
          if (item) Object.assign(item, { status: 'RESOLVED', resolvedAt: at });
        }
      }
      save();
      return chatView(chat);
    },

    async adminOverview() { throw new Error('The admin panel needs the cloud version.'); },
    async moderate() { throw new Error('The admin panel needs the cloud version.'); },

    /** Restores the sample board. */
    reset() {
      items = seedItems();
      chats = seedChats();
      save();
    },
  };
}

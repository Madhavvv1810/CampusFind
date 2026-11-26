// App-wide state and a tiny event bus. Views read `state` and re-render on events
// ("items", "threads", "user") instead of calling each other directly.

export const state = {
  backend: null, // cloudBackend or the demo backend (same methods)
  statsBackend: null, // public stats: the cloud even when signed out
  user: null, // { id, name, isAdmin } when signed in
  items: [],
  cursor: null,
  filter: 'ALL', // ALL | LOST | FOUND | MINE
  category: '',
  search: '',
  threads: [],
  unread: 0,
};

const bus = new EventTarget();
/** Subscribes to an event; returns a function that unsubscribes (pages call it when you navigate away). */
export function on(name, listener) {
  bus.addEventListener(name, listener);
  return () => bus.removeEventListener(name, listener);
}
export const emit = name => bus.dispatchEvent(new Event(name));

export const isCloud = () => state.backend?.mode === 'cloud';
export const findItem = id => state.items.find(item => item.itemId === id);

/** Replaces (or adds) one post in the board without reloading everything. */
export function upsertItem(item) {
  const index = state.items.findIndex(existing => existing.itemId === item.itemId);
  if (item.status === 'REMOVED') { if (index >= 0) state.items.splice(index, 1); }
  else if (index >= 0) state.items[index] = { ...state.items[index], ...item };
  else state.items.unshift(item);
  emit('items');
}

export async function reloadItems() {
  const page = await state.backend.listItems();
  state.items = page.items;
  state.cursor = page.cursor;
  emit('items');
}

export async function loadMoreItems() {
  if (!state.cursor) return;
  const page = await state.backend.listItems(state.cursor);
  const known = new Set(state.items.map(item => item.itemId));
  state.items.push(...page.items.filter(item => !known.has(item.itemId)));
  state.cursor = page.cursor;
  emit('items');
}

export async function reloadInbox() {
  const { threads, unread } = await state.backend.inbox();
  state.threads = threads;
  state.unread = unread;
  emit('threads');
}

// Lost/found match scoring. Pure and dependency-free: the API uses it, and the browser
// demo imports a byte-identical copy (web/js/matching.js, checked in CI).
//
// It understands WHAT the item is (buds = earbuds = airpods) and its COLOUR, so black
// earbuds never match a calculator just because both are "Electronics".
// Score (0-100) = 10 base + 35 same item type + 15 same category + 15 same colour
//   + 15 same place + up to 10 shared words + up to 15 photo resemblance + up to 10 labels;
//   different colours cost 15, and different item types are never suggested.

export const MIN_SCORE = 40;
export const MAX_RESULTS = 8;

/** Item types and the words students use for them. */
export const ITEM_TYPES = {
  earbuds: ['earbuds', 'earbud', 'buds', 'airpods', 'earphones', 'earphone', 'headphones', 'headphone', 'headset', 'tws', 'neckband'],
  phone: ['phone', 'mobile', 'iphone', 'smartphone', 'cellphone'],
  charger: ['charger', 'adapter', 'cable', 'powerbank'],
  laptop: ['laptop', 'macbook', 'chromebook'],
  calculator: ['calculator', 'casio'],
  watch: ['watch', 'smartwatch'],
  bottle: ['bottle', 'flask', 'sipper', 'tumbler'],
  keys: ['key', 'keys', 'keychain', 'keyring'],
  wallet: ['wallet', 'purse'],
  card: ['card', 'id', 'identity', 'icard'],
  bag: ['bag', 'backpack', 'pouch', 'sling'],
  umbrella: ['umbrella'],
  book: ['notebook', 'book', 'register', 'notes', 'diary'],
  clothing: ['hoodie', 'jacket', 'sweatshirt', 'sweater', 'shirt', 'cap', 'scarf'],
  glasses: ['glasses', 'spectacles', 'specs', 'sunglasses'],
};
const COLOURS = {
  black: 'black', white: 'white', blue: 'blue', navy: 'blue', red: 'red', maroon: 'red', green: 'green', grey: 'grey', gray: 'grey',
  silver: 'silver', gold: 'gold', pink: 'pink', brown: 'brown', yellow: 'yellow', purple: 'purple', orange: 'orange',
};

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'item', 'found', 'lost', 'near', 'my', 'its', 'has', 'was', 'have', 'colour', 'color', 'not']);
const TYPE_OF = new Map(Object.entries(ITEM_TYPES).flatMap(([type, aliases]) => aliases.map(alias => [alias, type])));

const tokens = value => String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Descriptive words, without item-type and colour words (those are scored separately). */
export function words(value) {
  return new Set(tokens(value).filter(word => word.length >= 3 && !STOP_WORDS.has(word) && !TYPE_OF.has(word) && !COLOURS[word]));
}
export const itemTypes = value => new Set(tokens(value).map(word => TYPE_OF.get(word)).filter(Boolean));
export const colours = value => new Set(tokens(value).map(word => COLOURS[word]).filter(Boolean));

/** Jaccard similarity of the two texts' descriptive words, 0..1. */
export function textSimilarity(first, second) {
  const left = words(first);
  const right = words(second);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / union.size;
}

/** Compares two 64-bit perceptual hashes (16 hex chars) by Hamming distance. */
export function photoSimilarity(first, second) {
  const hex = /^[a-f0-9]{16}$/i;
  if (!hex.test(first ?? '') || !hex.test(second ?? '')) return null;
  let distance = 0;
  for (let i = 0; i < 16; i += 1) {
    let bits = parseInt(first[i], 16) ^ parseInt(second[i], 16);
    while (bits) { distance += bits & 1; bits >>>= 1; }
  }
  if (distance > 24) return null;
  const label = distance <= 8 ? 'Very similar photo' : distance <= 17 ? 'Similar photo' : 'Some photo resemblance';
  return { distance, label, bonus: Math.max(4, Math.round(((24 - distance) / 24) * 15)) };
}

const place = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** "Central Library, ground floor" and "central library" count as the same place. */
export function samePlace(first, second) {
  const a = place(first);
  const b = place(second);
  if (!a || !b) return false;
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)); // short names must match exactly
}

const intersect = (a, b) => [...a].filter(value => b.has(value));
const describe = item => `${item.title ?? ''} ${item.description ?? ''}`;

export function scoreMatch(source, candidate) {
  const sourceTypes = itemTypes(describe(source));
  const candidateTypes = itemTypes(describe(candidate));
  const sharedTypes = intersect(sourceTypes, candidateTypes);
  const typeConflict = sourceTypes.size > 0 && candidateTypes.size > 0 && sharedTypes.length === 0;

  const sourceColours = colours(describe(source));
  const candidateColours = colours(describe(candidate));
  const sharedColours = intersect(sourceColours, candidateColours);
  const colourConflict = sourceColours.size > 0 && candidateColours.size > 0 && sharedColours.length === 0;

  const sourceLabels = new Set((source.labels ?? []).map(label => String(label).toLowerCase()));
  const sharedLabels = (candidate.labels ?? []).filter(label => sourceLabels.has(String(label).toLowerCase()));
  const sameCategory = Boolean(source.category && source.category === candidate.category);
  const sameLocation = samePlace(source.location, candidate.location);
  const titleOverlap = textSimilarity(describe(source), describe(candidate));
  const photo = photoSimilarity(source.visualHash, candidate.visualHash);

  const score = typeConflict ? 0 : Math.max(0, Math.min(100,
    10
    + (sharedTypes.length ? 35 : 0)
    + (sameCategory ? 15 : 0)
    + (sharedColours.length ? 15 : 0) - (colourConflict ? 15 : 0)
    + (sameLocation ? 15 : 0)
    + Math.round(titleOverlap * 10)
    + Math.min(10, sharedLabels.length * 5)
    + (photo?.bonus ?? 0)));

  return {
    score, sharedLabels, sameCategory, sameLocation, titleOverlap, photoSimilarity: photo?.label ?? null,
    sameType: sharedTypes[0] ?? null, sameColour: sharedColours[0] ?? null, colourConflict, typeConflict,
  };
}

/** Scores candidates of the opposite type and returns the best few, highest first. */
export function rankMatches(source, candidates) {
  const opposite = source.itemType === 'LOST' ? 'FOUND' : 'LOST';
  return candidates
    .filter(candidate => candidate.itemId !== source.itemId && candidate.itemType === opposite && candidate.status === 'ACTIVE')
    .filter(candidate => !source.category || !candidate.category || candidate.category === source.category)
    .map(candidate => ({ ...candidate, ...scoreMatch(source, candidate) }))
    .filter(candidate => !candidate.typeConflict && candidate.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}

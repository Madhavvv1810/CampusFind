// Lost/found match scoring. Pure and dependency-free: the API uses it, and the browser
// demo imports a byte-identical copy (web/js/matching.js, checked in CI).
//
// Score = 40 base + 20 same category + up to 30 for shared words (Jaccard)
//       + 5 per shared photo label (max 15) + 10 same place + up to 25 for photo resemblance.

export const MIN_SCORE = 45;
export const MAX_RESULTS = 8;

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'item', 'found', 'lost', 'near', 'my', 'its', 'has', 'was', 'have']);

export function words(value) {
  const tokens = String(value ?? '').toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(tokens.filter(word => !STOP_WORDS.has(word)));
}

/** Jaccard similarity of the two texts' word sets, 0..1. */
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
  return { distance, label, bonus: Math.max(5, Math.round(((24 - distance) / 24) * 20) + 5) };
}

const place = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** "Central Library, ground floor" and "central library" count as the same place. */
export function samePlace(first, second) {
  const a = place(first);
  const b = place(second);
  if (a.length < 4 || b.length < 4) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function scoreMatch(source, candidate) {
  const sourceLabels = new Set((source.labels ?? []).map(label => String(label).toLowerCase()));
  const sharedLabels = (candidate.labels ?? []).filter(label => sourceLabels.has(String(label).toLowerCase()));
  const sameCategory = Boolean(source.category && source.category === candidate.category);
  const sameLocation = samePlace(source.location, candidate.location);
  const titleOverlap = textSimilarity(`${source.title} ${source.description}`, `${candidate.title} ${candidate.description}`);
  const photo = photoSimilarity(source.visualHash, candidate.visualHash);
  const score = Math.min(100,
    40
    + (sameCategory ? 20 : 0)
    + Math.round(titleOverlap * 30)
    + Math.min(15, sharedLabels.length * 5)
    + (sameLocation ? 10 : 0)
    + (photo?.bonus ?? 0));
  return { score, sharedLabels, sameCategory, sameLocation, titleOverlap, photoSimilarity: photo?.label ?? null };
}

/** Scores candidates of the opposite type and returns the best few, highest first. */
export function rankMatches(source, candidates) {
  const opposite = source.itemType === 'LOST' ? 'FOUND' : 'LOST';
  return candidates
    .filter(candidate => candidate.itemId !== source.itemId && candidate.itemType === opposite && candidate.status === 'ACTIVE')
    .filter(candidate => !source.category || !candidate.category || candidate.category === source.category)
    .map(candidate => ({ ...candidate, ...scoreMatch(source, candidate) }))
    .filter(candidate => candidate.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}

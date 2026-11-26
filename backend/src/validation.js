// Input rules for posts, chats and reports. Pure functions: they return cleaned values or throw HttpError(400).
import { fail } from './http.js';

export const CATEGORIES = {
  electronics: 'Electronics', keys: 'Keys', 'id-cards': 'ID card', bags: 'Bag',
  clothing: 'Clothing', bottles: 'Bottle', books: 'Book or notebook', other: 'Other',
};
/** Where a finder left the item. */
export const HANDOVER_POINTS = {
  'with-finder': 'With the finder', security: 'Security office', library: 'Library help desk', department: 'Department office',
};
export const REPORT_REASONS = ['spam', 'inappropriate', 'duplicate', 'scam', 'other'];
export const PHOTO_TYPES = ['image/jpeg', 'image/png'];
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const multiline = (value, max) => String(value ?? '').trim().replace(/\n{3,}/g, '\n\n').slice(0, max);

/** YYYY-MM-DD that is a real date and not in the future; anything else becomes null. */
export function dateOrNull(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getTime() <= today.getTime() + 86_400_000 ? value : null;
}

/** The editable fields of a post, cleaned. */
export function postFields(body, itemType) {
  const category = text(body.category, 30).toLowerCase();
  if (category && !CATEGORIES[category]) fail(400, 'Choose a valid category.');
  const handover = text(body.handover, 30);
  if (handover && (itemType !== 'FOUND' || !HANDOVER_POINTS[handover])) fail(400, 'Choose where the found item is kept.');
  return {
    title: text(body.title, 80),
    description: multiline(body.description, 400),
    location: text(body.location, 80),
    category,
    occurredOn: dateOrNull(body.occurredOn),
    handover: handover || null,
  };
}

function requireComplete(itemType, fields, hasPhoto) {
  if (itemType === 'LOST' && (!fields.title || !fields.category || !fields.location)) {
    fail(400, 'For a lost item, add a title, category and campus location.');
  }
  if (itemType === 'FOUND' && !fields.title && !fields.category) {
    fail(400, 'For a found item, add either a title or a category.');
  }
  if (itemType === 'FOUND' && !hasPhoto) fail(400, 'A found item needs a photo.');
}

export function validateNewPost(body) {
  const itemType = text(body.itemType, 10).toUpperCase();
  if (!['LOST', 'FOUND'].includes(itemType)) fail(400, 'Choose whether the item was lost or found.');
  const fields = postFields(body, itemType);

  let photo = null;
  if (body.file) {
    const size = Number(body.file.size);
    if (!PHOTO_TYPES.includes(body.file.contentType) || !Number.isInteger(size) || size < 1 || size > MAX_PHOTO_BYTES) {
      fail(400, 'Upload a JPG or PNG photo up to 5 MB, or continue without a photo.');
    }
    photo = { contentType: body.file.contentType, size };
  }
  requireComplete(itemType, fields, Boolean(photo));

  const visualHash = body.visualHash ? text(body.visualHash, 16).toLowerCase() : null;
  if (visualHash && !/^[a-f0-9]{16}$/.test(visualHash)) fail(400, 'The photo fingerprint is invalid. Choose the photo again.');
  return { itemType, fields, photo, visualHash: photo ? visualHash : null };
}

/** Owner edits: only fields present in the body change; the result must still be a complete post. */
export function validateEdit(body, item) {
  const editable = ['title', 'description', 'location', 'category', 'occurredOn', 'handover'];
  const provided = editable.filter(key => key in body);
  if (!provided.length) fail(400, 'Nothing to update.');
  const cleaned = postFields({ ...item, ...body }, item.itemType);
  requireComplete(item.itemType, cleaned, item.hasPhoto);
  return Object.fromEntries(provided.map(key => [key, cleaned[key]]));
}

export function chatMessage(value, { min = 1 } = {}) {
  const message = multiline(value, 500);
  if (message.length < min) {
    fail(400, min > 1 ? 'Add a short detail that helps the owner verify the item.' : 'Write a message first.');
  }
  return message;
}

export function reportReason(value) {
  const reason = text(value, 20).toLowerCase();
  if (!REPORT_REASONS.includes(reason)) fail(400, 'Choose a reason for the report.');
  return reason;
}

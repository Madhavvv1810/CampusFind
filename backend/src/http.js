// HTTP helpers shared by every route: typed errors, JSON responses and body parsing.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** A store-level conflict: a DynamoDB condition failed because the record changed. */
export class ConflictError extends Error {
  constructor(message = 'This post changed. Refresh and try again.') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Throws an HttpError. Use as a guard: `if (!item) fail(404, 'Not found.')`. */
export function fail(status, message) {
  throw new HttpError(status, message);
}

export const ok = (body, headers) => ({ status: 200, body, headers });
export const created = body => ({ status: 201, body });
export const accepted = body => ({ status: 202, body });

export function respond(status, body, headers = {}) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

export function parseJsonBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fail(400, 'Request body must be a JSON object.');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return fail(400, 'Request body must be valid JSON.');
  }
}

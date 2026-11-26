// The API as a plain function of (event) -> response, built from injected dependencies so it
// runs the same against AWS (index.js) and against in-memory fakes (tests).
import { HttpError, ConflictError, respond, parseJsonBody, fail } from './http.js';
import { userFromEvent } from './identity.js';
import { createLogger } from './log.js';
import * as items from './routes/items.js';
import * as claims from './routes/claims.js';
import * as admin from './routes/admin.js';

/** Route keys match API Gateway's `routeKey` ("METHOD /path/{param}"); see template.yaml. */
export const ROUTES = {
  'GET /stats': { handler: admin.publicStats, public: true },
  'GET /items': { handler: items.listItems },
  'POST /items': { handler: items.createItem },
  'GET /items/{itemId}': { handler: items.getItem },
  'PATCH /items/{itemId}': { handler: items.updateItem },
  'DELETE /items/{itemId}': { handler: items.deleteItem },
  'POST /items/{itemId}/complete': { handler: items.completeUpload },
  'GET /items/{itemId}/matches': { handler: items.matchesFor },
  'POST /items/{itemId}/report': { handler: items.reportItem },
  'GET /items/{itemId}/claims': { handler: claims.listChats },
  'POST /items/{itemId}/claims': { handler: claims.startChat },
  'PATCH /items/{itemId}/claims/{claimId}': { handler: claims.updateChat },
  'POST /items/{itemId}/claims/{claimId}/messages': { handler: claims.sendMessage },
  'GET /inbox': { handler: claims.inbox },
  'GET /admin/overview': { handler: admin.overview },
  'POST /admin/items/{itemId}/moderate': { handler: admin.moderate },
};

function toResponse(error, log, context) {
  if (error instanceof HttpError) return respond(error.status, { message: error.message });
  if (error instanceof ConflictError) return respond(409, { message: error.message });
  log.error('unhandled error', { ...context, error: error.name, detail: error.message });
  return respond(500, { message: 'Something went wrong on our side. Please try again.' });
}

export function createApp(deps) {
  const log = deps.log ?? createLogger();
  const context = { clock: () => new Date(), newId: () => crypto.randomUUID(), retentionDays: 90, ...deps, log };

  return async function handle(event) {
    const started = Date.now();
    const routeKey = event.routeKey ?? `${event.requestContext?.http?.method} ${event.rawPath}`;
    const user = userFromEvent(event);
    let response;
    try {
      const route = ROUTES[routeKey] ?? fail(404, 'Route not found.');
      if (!route.public && !user) fail(401, 'Please sign in again.');
      const result = await route.handler({
        deps: context,
        user,
        params: event.pathParameters ?? {},
        query: event.queryStringParameters ?? {},
        body: parseJsonBody(event),
      });
      response = respond(result.status, result.body, result.headers);
    } catch (error) {
      response = toResponse(error, log, { route: routeKey });
    }
    log.info('request', { route: routeKey, status: response.statusCode, ms: Date.now() - started, admin: Boolean(user?.isAdmin) });
    return response;
  };
}

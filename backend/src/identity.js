// Who is calling. API Gateway's Cognito JWT authorizer has already verified the token
// (signature, issuer, audience, expiry); here we only read its claims.

export const ADMIN_GROUP = 'admins';

/** HTTP APIs pass array claims as a string like "[admins staff]"; accept both forms. */
export function parseGroups(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? '').replace(/[[\]]/g, '').split(/[\s,]+/).filter(Boolean);
}

/** "Madhav Singla" -> "Madhav S." so other students never see full names or emails. */
export function displayName({ name, email } = {}) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.`.slice(0, 40);
  if (parts.length === 1) return parts[0].slice(0, 40);
  return String(email ?? 'Student').split('@')[0].slice(0, 40) || 'Student';
}

export function userFromEvent(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims?.sub) return null;
  return {
    id: claims.sub,
    name: displayName(claims),
    isAdmin: parseGroups(claims['cognito:groups']).includes(ADMIN_GROUP),
  };
}

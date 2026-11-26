// Cognito pre-sign-up trigger: only college email addresses may create an account.
export function isAllowedEmail(email, domain) {
  const allowed = String(domain ?? '').trim().toLowerCase();
  return !allowed || String(email ?? '').trim().toLowerCase().endsWith(`@${allowed}`);
}

export async function handler(event) {
  const domain = process.env.ALLOWED_EMAIL_DOMAIN;
  if (!isAllowedEmail(event.request?.userAttributes?.email, domain)) {
    throw new Error(`Please sign up with your @${domain} email address.`);
  }
  return event;
}

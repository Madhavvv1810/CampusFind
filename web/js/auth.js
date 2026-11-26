// Sign-in with the Amazon Cognito hosted UI: OAuth 2.0 authorization-code flow with PKCE.
// No client secret exists; tokens are exchanged directly with Cognito and refreshed silently.
import { storage, readJson } from './util.js';

const AUTH_KEY = 'campusfind-auth';
const PKCE_KEY = 'campusfind-pkce';
const config = window.CAMPUSFIND_CONFIG ?? {};

export const cloudConfigured = () => Boolean(config.apiUrl && config.cognitoDomain && config.clientId);
const redirectUri = () => `${location.origin}/`;
const base64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let session = storage.get(AUTH_KEY);

/** Decodes a JWT payload (no verification: API Gateway verifies every request). */
export function tokenClaims(token) {
  try {
    const json = atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, char => char.charCodeAt(0))));
  } catch {
    return {};
  }
}

export function currentUser() {
  if (!session?.idToken) return null;
  const claims = tokenClaims(session.idToken);
  const groups = claims['cognito:groups'] ?? [];
  return { id: claims.sub, name: claims.name || claims.email, email: claims.email, isAdmin: groups.includes('admins') };
}

function save(tokens) {
  session = {
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token ?? session?.refreshToken,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
  storage.set(AUTH_KEY, session);
}

export function clearSession() {
  session = null;
  storage.remove(AUTH_KEY);
}

async function tokenRequest(params) {
  const response = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, ...params }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id_token) throw new Error(data.error_description || 'Sign-in could not be completed. Please try again.');
  return data;
}

/** Sends the browser to Cognito's sign-in (or sign-up) page. */
export async function signIn(screen = 'login') {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnTo: location.pathname + location.search }));
  const query = new URLSearchParams({
    client_id: config.clientId, response_type: 'code', scope: 'openid email profile',
    redirect_uri: redirectUri(), state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  location.href = `${config.cognitoDomain}/${screen === 'signup' ? 'signup' : 'login'}?${query}`;
}

/** Completes sign-in when Cognito redirects back with ?code=…; returns the hash to restore. */
export async function finishSignIn() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return null;
  history.replaceState(null, '', location.pathname);
  if (params.has('error')) throw new Error(params.get('error_description') || 'Sign-in was cancelled.');
  const saved = readJson(sessionStorage.getItem(PKCE_KEY), {});
  sessionStorage.removeItem(PKCE_KEY);
  if (!saved.verifier || params.get('state') !== saved.state) throw new Error('Sign-in could not be verified. Please try again.');
  save(await tokenRequest({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier }));
  return saved.returnTo || null;
}

/** A valid ID token, refreshed a minute before it expires. */
export async function idToken() {
  if (!session) throw new Error('Please sign in.');
  if (session.expiresAt - Date.now() < 60_000) {
    if (!session.refreshToken) { clearSession(); throw new Error('Your session expired. Please sign in again.'); }
    try {
      save(await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refreshToken }));
    } catch {
      clearSession();
      throw new Error('Your session expired. Please sign in again.');
    }
  }
  return session.idToken;
}

export function signOut() {
  clearSession();
  location.href = `${config.cognitoDomain}/logout?${new URLSearchParams({ client_id: config.clientId, logout_uri: redirectUri() })}`;
}

export const apiUrl = () => config.apiUrl;

// Unified Google auth: one consent popup grants BOTH sign-in identity (sub/email/name)
// AND drive.appdata scope for encrypted backups. After consent we hold an access token
// in memory; user info is fetched once via /oauth2/v3/userinfo.
//
// Client ID resolution order:
//   1. Build-time env var  VITE_GOOGLE_CLIENT_ID  (set in Vercel for "WhatsApp-style" flow)
//   2. Stored setting      drive.clientId         (per-device fallback)
//   3. None                                       (show setup UI)

import { getSetting } from '@/db/database.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPES =
  'openid email profile https://www.googleapis.com/auth/drive.appdata';

const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

let _gisReady = null;
let _tokenClient = null;
let _currentClientId = null;
let _accessToken = null;
let _expiresAt = 0;
let _userInfo = null;

export function envHasClientId() {
  return !!ENV_CLIENT_ID;
}

export async function getEffectiveClientId() {
  if (ENV_CLIENT_ID) return ENV_CLIENT_ID;
  return ((await getSetting('drive.clientId', '')) ?? '').trim();
}

function loadGis() {
  if (_gisReady) return _gisReady;
  _gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(s);
  });
  return _gisReady;
}

async function ensureTokenClient(clientId) {
  await loadGis();
  if (_tokenClient && _currentClientId === clientId) return _tokenClient;
  _currentClientId = clientId;
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => {} // replaced per request
  });
  return _tokenClient;
}

function isTokenValid() {
  return !!_accessToken && _expiresAt > Date.now() + 5000;
}

export function getAccessToken() {
  return isTokenValid() ? _accessToken : null;
}

export function getUserInfo() {
  return _userInfo;
}

export function isSignedIn() {
  return isTokenValid();
}

/**
 * Request a fresh token. `prompt`:
 *   ''         → silent if Google can; popup if needed
 *   'consent'  → always show consent (first time or re-consent)
 */
async function requestToken(clientId, prompt = '') {
  const tc = await ensureTokenClient(clientId);
  return new Promise((resolve, reject) => {
    tc.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error));
        return;
      }
      _accessToken = resp.access_token;
      _expiresAt = Date.now() + Number(resp.expires_in ?? 3600) * 1000;
      resolve(resp);
    };
    try {
      tc.requestAccessToken({ prompt });
    } catch (e) {
      reject(e);
    }
  });
}

async function fetchUserInfo() {
  if (!_accessToken) throw new Error('No access token.');
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${_accessToken}` }
  });
  if (!r.ok) throw new Error('Could not fetch your Google profile (' + r.status + ').');
  const j = await r.json();
  _userInfo = {
    sub: j.sub,
    email: j.email,
    name: j.name,
    picture: j.picture,
    givenName: j.given_name,
    emailVerified: !!j.email_verified
  };
  return _userInfo;
}

/**
 * Public: trigger the unified sign-in flow.
 * Returns user info { sub, email, name, picture, ... }.
 */
export async function signInWithGoogle(clientId) {
  if (!clientId) throw new Error('Google Client ID is not configured.');
  await requestToken(clientId, ''); // Google chooses popup vs silent
  return fetchUserInfo();
}

/** Try to refresh the access token silently (no UI). Returns true on success. */
export async function silentReauth() {
  if (!_currentClientId) return false;
  try {
    await requestToken(_currentClientId, '');
    return isTokenValid();
  } catch {
    return false;
  }
}

export function signOutGoogle() {
  if (_accessToken && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(_accessToken, () => {}); } catch {}
  }
  _accessToken = null;
  _expiresAt = 0;
  _userInfo = null;
}

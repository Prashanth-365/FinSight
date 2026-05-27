// Google auth — two code paths:
//
//  Web (Vercel, dev server):
//    Google Identity Services (GIS) token-client flow inside the same page.
//    Returns an access token directly via JS callback.
//
//  Android APK (Capacitor WebView):
//    GIS refuses to load in embedded webviews (deliberate Google policy to
//    prevent phishing), so we open Google's OAuth page in a real Chrome Custom
//    Tab via @capacitor/browser. After consent, Google redirects to our
//    oauth-redirect.html page on Vercel, which forwards via a custom-scheme
//    deep link (com.finsight.app://oauth-success#access_token=...) back into
//    the app. We listen for that URL via @capacitor/app.
//
// Both flows end up storing the same in-memory access token and user info.

import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { getSetting } from '@/db/database.js';

const SCOPES =
  'openid email profile https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const ENV_REDIRECT_URL =
  import.meta.env.VITE_OAUTH_REDIRECT_URL ??
  // Fallback: same-origin /oauth-redirect.html. Works in the web build; for the
  // APK we strongly recommend setting VITE_OAUTH_REDIRECT_URL to the Vercel URL.
  (typeof window !== 'undefined' ? `${window.location.origin}/oauth-redirect.html` : '');

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

function isTokenValid() {
  return !!_accessToken && _expiresAt > Date.now() + 5000;
}
export function getAccessToken() {
  return isTokenValid() ? _accessToken : null;
}
export function getUserInfo() { return _userInfo; }
export function isSignedIn() { return isTokenValid(); }
export const isNativeAndroid = () => Capacitor.getPlatform() === 'android';

/* ───────── Web (GIS) flow ───────── */

let _gisReady = null;
let _gisClient = null;
let _gisClientId = null;

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

async function gisRequestToken(clientId) {
  await loadGis();
  if (!_gisClient || _gisClientId !== clientId) {
    _gisClientId = clientId;
    _gisClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: () => {}
    });
  }
  return new Promise((resolve, reject) => {
    _gisClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      _accessToken = resp.access_token;
      _expiresAt = Date.now() + Number(resp.expires_in ?? 3600) * 1000;
      resolve(resp);
    };
    try { _gisClient.requestAccessToken({ prompt: '' }); }
    catch (e) { reject(e); }
  });
}

/* ───────── Android (Custom Tab + deep link) flow ───────── */

function randomState() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function nativeRequestToken(clientId) {
  if (!ENV_REDIRECT_URL) {
    throw new Error(
      'OAuth redirect URL not configured. Set VITE_OAUTH_REDIRECT_URL to your Vercel URL + /oauth-redirect.html.'
    );
  }
  const state = randomState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ENV_REDIRECT_URL,
    response_type: 'token',
    scope: SCOPES,
    state,
    prompt: 'consent',
    include_granted_scopes: 'true'
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  // Wait for the deep link back
  const tokenPromise = new Promise((resolve, reject) => {
    let handlerReg, timeout;
    const cleanup = async () => {
      try { (await handlerReg)?.remove?.(); } catch {}
      clearTimeout(timeout);
    };
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Sign-in timed out. Please try again.'));
    }, 5 * 60 * 1000);

    handlerReg = App.addListener('appUrlOpen', async ({ url }) => {
      if (!url || !url.startsWith('com.finsight.app://oauth-success')) return;
      const fragment = url.split('#')[1] ?? url.split('?')[1] ?? '';
      const got = new URLSearchParams(fragment);
      if (got.get('error')) {
        await cleanup();
        return reject(new Error(got.get('error_description') || got.get('error')));
      }
      if (got.get('state') !== state) {
        await cleanup();
        return reject(new Error('State mismatch — please try signing in again.'));
      }
      const accessToken = got.get('access_token');
      if (!accessToken) {
        await cleanup();
        return reject(new Error('No access token received from Google.'));
      }
      _accessToken = accessToken;
      _expiresAt = Date.now() + Number(got.get('expires_in') ?? 3600) * 1000;
      try { await Browser.close(); } catch {}
      await cleanup();
      resolve({ access_token: accessToken });
    });
  });

  await Browser.open({
    url: authUrl,
    presentationStyle: 'popover',
    windowName: '_self'
  });
  return tokenPromise;
}

/* ───────── Unified API ───────── */

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

export async function signInWithGoogle(clientId) {
  if (!clientId) throw new Error('Google Client ID is not configured.');
  if (isNativeAndroid()) await nativeRequestToken(clientId);
  else await gisRequestToken(clientId);
  return fetchUserInfo();
}

export async function silentReauth() {
  // On native, silent reauth isn't really possible (token expired = need user
  // interaction). Caller should ask the user to sign in again.
  if (isNativeAndroid()) return false;
  if (!_gisClientId) return false;
  try {
    await gisRequestToken(_gisClientId);
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

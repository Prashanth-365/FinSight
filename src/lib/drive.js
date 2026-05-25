// Google Drive sync via Google Identity Services (token-client / FedCM where supported).
// Scope is locked to "drive.appdata" — a hidden per-app folder no other app can read.
// Access token lives in memory only; it is NOT persisted. Re-auth is silent when possible.

const BACKUP_FILE = 'finsight-backup.json.enc';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let _gisReady = null;
let _tokenClient = null;
let _tokenInfo = null; // { access_token, expires_at }
let _clientId = null;

function loadGisOnce() {
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

function ensureTokenClient(clientId) {
  if (_tokenClient && _clientId === clientId) return _tokenClient;
  _clientId = clientId;
  _tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: () => {} // replaced per-request
  });
  return _tokenClient;
}

export function isConnected() {
  return !!(_tokenInfo?.access_token && _tokenInfo.expires_at > Date.now() + 5000);
}

/**
 * Request an access token. `prompt`:
 *   ''         → silent if Google can; popup if needed
 *   'consent'  → always show consent (first time)
 */
export async function connect(clientId, prompt = '') {
  if (!clientId) throw new Error('Google OAuth Client ID is required.');
  await loadGisOnce();
  const tc = ensureTokenClient(clientId);
  return new Promise((resolve, reject) => {
    tc.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error));
        return;
      }
      _tokenInfo = {
        access_token: resp.access_token,
        expires_at: Date.now() + Number(resp.expires_in ?? 3600) * 1000
      };
      resolve(_tokenInfo);
    };
    try {
      tc.requestAccessToken({ prompt });
    } catch (e) {
      reject(e);
    }
  });
}

export function disconnect() {
  if (_tokenInfo?.access_token && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(_tokenInfo.access_token, () => {}); } catch {}
  }
  _tokenInfo = null;
}

async function authedFetch(url, opts = {}, retry = true) {
  if (!isConnected()) {
    if (!_clientId) throw new Error('Not connected to Google Drive.');
    await connect(_clientId, ''); // silent re-auth
  }
  const r = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${_tokenInfo.access_token}`
    }
  });
  if (r.status === 401 && retry) {
    _tokenInfo = null;
    await connect(_clientId, '');
    return authedFetch(url, opts, false);
  }
  return r;
}

async function driveError(r, label) {
  let detail = '';
  try {
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const j = await r.json();
      const err = j?.error;
      const reason = err?.errors?.[0]?.reason;
      detail = [err?.message, reason].filter(Boolean).join(' · ');
    } else {
      detail = (await r.text()).slice(0, 200);
    }
  } catch {}
  const hint =
    r.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(detail)
      ? ' — Drive API is not enabled for the project that owns this OAuth Client ID. Enable it at https://console.cloud.google.com/apis/library/drive.googleapis.com'
      : r.status === 403 && /insufficient/i.test(detail)
      ? ' — token is missing the drive.appdata scope. Click Disconnect, hard-reload, then Connect again.'
      : '';
  return new Error(`${label} failed (${r.status})${detail ? ': ' + detail : ''}${hint}`);
}

export async function findBackup() {
  const q = encodeURIComponent(`name='${BACKUP_FILE}' and trashed=false`);
  const url = `${DRIVE_BASE}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,size)`;
  const r = await authedFetch(url);
  if (!r.ok) throw await driveError(r, 'Drive list');
  const j = await r.json();
  return j.files?.[0] ?? null;
}

export async function uploadBackup(envelope) {
  const existing = await findBackup();
  const meta = existing
    ? { name: BACKUP_FILE }
    : { name: BACKUP_FILE, parents: ['appDataFolder'] };

  const boundary = 'fs_' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(envelope) +
    `\r\n--${boundary}--`;

  const url = existing
    ? `${UPLOAD_BASE}/files/${existing.id}?uploadType=multipart&fields=id,modifiedTime,size`
    : `${UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime,size`;

  const r = await authedFetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (!r.ok) throw await driveError(r, 'Drive upload');
  return r.json();
}

export async function downloadBackup() {
  const f = await findBackup();
  if (!f) return null;
  const r = await authedFetch(`${DRIVE_BASE}/files/${f.id}?alt=media`);
  if (!r.ok) throw await driveError(r, 'Drive download');
  const envelope = await r.json();
  return { envelope, modifiedTime: f.modifiedTime, size: f.size };
}

export async function deleteBackup() {
  const f = await findBackup();
  if (!f) return false;
  const r = await authedFetch(`${DRIVE_BASE}/files/${f.id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw await driveError(r, 'Drive delete');
  return true;
}

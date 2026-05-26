// Drive sync against the user's hidden appDataFolder. Reuses the access token from
// googleAuth.js — the token is granted at sign-in alongside drive.appdata scope, so
// there's no separate "Connect Drive" step for the user.

import { getAccessToken, silentReauth, isSignedIn } from './googleAuth.js';

const BACKUP_FILE = 'finsight-backup.json.enc';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export function isConnected() {
  return isSignedIn();
}

async function authedFetch(url, opts = {}, retry = true) {
  let token = getAccessToken();
  if (!token) {
    const ok = await silentReauth();
    if (!ok) throw new Error('Your Google session expired. Please sign in again.');
    token = getAccessToken();
  }
  const r = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      Authorization: `Bearer ${token}`
    }
  });
  if (r.status === 401 && retry) {
    const ok = await silentReauth();
    if (ok) return authedFetch(url, opts, false);
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
      ? ' — token is missing the drive.appdata scope. Sign out, hard-reload, then sign in again.'
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

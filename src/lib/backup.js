// Orchestrates: dump DB → (optionally encrypt) → upload, and download → (decrypt if needed) → restore.
import { db, reindexSlNo, setSetting } from '@/db/database.js';
import { encryptJson, decryptJson } from './crypto.js';
import { uploadBackup, downloadBackup, findBackup } from './drive.js';

const TABLES = [
  'users', 'profiles', 'accounts', 'categories',
  'transactions', 'investments', 'chitFunds', 'smsQueue', 'settings'
];

async function dumpAll() {
  const data = {};
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return { version: 1, exportedAt: Date.now(), data };
}

async function restoreAll(payload) {
  if (!payload?.data) throw new Error('Backup payload is malformed.');
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      if (Array.isArray(payload.data[t]) && payload.data[t].length) {
        await db.table(t).bulkAdd(payload.data[t]);
      }
    }
  });
  await reindexSlNo();
}

/**
 * Push a backup to Drive. Always overwrites the single backup file.
 * Pass { encrypt: false } to upload as plain JSON (passphrase is ignored).
 */
export async function pushBackup(passphrase, { encrypt = true } = {}) {
  const payload = await dumpAll();
  const envelope = encrypt
    ? await encryptJson(payload, passphrase)
    : payload; // plain JSON; identifiable by presence of `data` key, absence of `alg`
  const meta = await uploadBackup(envelope);
  await setSetting('drive.lastSyncedAt', Date.now());
  await setSetting('drive.remoteModifiedTime', meta.modifiedTime ?? null);
  await setSetting('drive.lastEncrypted', encrypt);
  return meta;
}

/**
 * Pull a backup from Drive and restore. Auto-detects encrypted vs plain.
 * Passphrase only required if the file is encrypted.
 */
export async function pullBackup(passphrase) {
  const got = await downloadBackup();
  if (!got) throw new Error('No backup found in Google Drive yet.');
  const env = got.envelope;

  let payload;
  if (env?.alg && env?.ct) {
    // encrypted envelope
    if (!passphrase) throw new Error('This backup is encrypted. Enter the passphrase to restore.');
    payload = await decryptJson(env, passphrase);
  } else if (env?.data) {
    // plaintext payload
    payload = env;
  } else {
    throw new Error('Backup file is in an unknown format.');
  }

  await restoreAll(payload);
  await setSetting('drive.lastSyncedAt', Date.now());
  await setSetting('drive.remoteModifiedTime', got.modifiedTime ?? null);
  return { restoredAt: Date.now(), exportedAt: payload.exportedAt };
}

export async function remoteStatus() {
  try {
    const f = await findBackup();
    return f ? { exists: true, modifiedTime: f.modifiedTime, size: Number(f.size ?? 0) } : { exists: false };
  } catch (e) {
    return { error: e.message };
  }
}

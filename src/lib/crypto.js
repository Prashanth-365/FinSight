// AES-256-GCM encryption with a PBKDF2-SHA256 derived key.
// Runs entirely in the browser via Web Crypto. The passphrase is never stored
// anywhere — it must be re-typed (or kept in memory) for each encrypt/decrypt.

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function b64encode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJson(obj, passphrase) {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );
  return {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ct: b64encode(ct)
  };
}

export async function decryptJson(envelope, passphrase) {
  if (!envelope?.salt || !envelope?.iv || !envelope?.ct) {
    throw new Error('Backup file is not a FinSight envelope.');
  }
  const salt = b64decode(envelope.salt);
  const iv = b64decode(envelope.iv);
  const ct = b64decode(envelope.ct);
  const key = await deriveKey(passphrase, salt);
  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    throw new Error('Wrong passphrase, or the backup is corrupt.');
  }
  return JSON.parse(new TextDecoder().decode(pt));
}

// Lightweight passphrase strength score (0–4)
export function passphraseScore(p) {
  if (!p) return 0;
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 14) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  return Math.min(score, 4);
}

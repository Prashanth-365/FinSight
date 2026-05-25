import bcrypt from 'bcryptjs';
import { db, getSetting, setSetting } from '@/db/database.js';

const SESSION_KEY = 'session.user';

export async function registerMaster({ username, email, password }) {
  username = (username || '').trim();
  email = (email || '').trim().toLowerCase();
  if (!username || !email || !password || password.length < 6) {
    throw new Error('Please provide a username, valid email, and a password (min 6 chars).');
  }
  const existing = await db.users.toArray();
  if (existing.length > 0) {
    throw new Error('A master account already exists on this device. Please log in instead.');
  }
  const hash = await bcrypt.hash(password, 10);
  const id = await db.users.add({ username, email, passwordHash: hash, createdAt: Date.now() });
  const user = { id, username, email };
  await setSetting(SESSION_KEY, user);
  return user;
}

export async function loginMaster({ identifier, password }) {
  identifier = (identifier || '').trim();
  if (!identifier || !password) throw new Error('Please enter your username/email and password.');
  const lower = identifier.toLowerCase();
  const user = (await db.users.toArray()).find(
    (u) => u.username.toLowerCase() === lower || u.email.toLowerCase() === lower
  );
  if (!user) throw new Error('No account found with that username or email.');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('Incorrect password.');
  const session = { id: user.id, username: user.username, email: user.email };
  await setSetting(SESSION_KEY, session);
  return session;
}

export async function getCurrentUser() {
  return (await getSetting(SESSION_KEY, null)) ?? null;
}

export async function logout() {
  await setSetting(SESSION_KEY, null);
}

export async function masterAccountExists() {
  return (await db.users.count()) > 0;
}

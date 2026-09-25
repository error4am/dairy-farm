'use strict';

const crypto = require('crypto');
const db = require('../db');
const { FARM_ID, SESSION_TTL_SECONDS, SETUP_SECRET, AUTH_ENABLED } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { hash, verify, Algorithm } = require('@node-rs/argon2');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const LOGIN_ERROR = 'Invalid email or password.';

const ARGON2_OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hash('dummy-password-for-timing', ARGON2_OPTIONS);
  }
  return dummyHashPromise;
}

async function hashPassword(password) {
  return hash(password, ARGON2_OPTIONS);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sessionExpiresAt() {
  return new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
}

async function hasOwner() {
  const row = await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users WHERE password_hash IS NOT NULL');
  return row.n > 0;
}

async function status() {
  const setupRequired = AUTH_ENABLED && !(await hasOwner());
  return { auth_enabled: AUTH_ENABLED, setup_required: setupRequired };
}

async function createSession(userId) {
  const token = newToken();
  await db.run('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', [
    hashToken(token),
    userId,
    sessionExpiresAt()
  ]);
  return token;
}

async function userForToken(token) {
  if (!token) return null;
  const row = await db.get(
    'SELECT u.id, u.email, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
    [hashToken(token)]
  );
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    await db.run('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

async function logout(token) {
  if (!token) return;
  await db.run('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
}

const SETUP_RULES = {
  name: { required: true, label: 'Name', maxLength: 120 },
  email: {
    required: true,
    label: 'Email',
    maxLength: 256,
    validate: (v) => (EMAIL_RE.test(v) ? null : 'Enter a valid email address.')
  },
  password: {
    required: true,
    label: 'Password',
    validate: (v) =>
      PASSWORD_RE.test(v) ? null : 'Password must be at least 8 characters long and contain letters and numbers.'
  },
  confirm_password: { required: true, label: 'Confirm password' },
  farm_name: { label: 'Farm name', maxLength: 120 }
};

async function setup(body) {
  if (await hasOwner()) {
    throw new HttpError(409, 'An owner account already exists.');
  }
  if (SETUP_SECRET && (!body || body.setup_secret !== SETUP_SECRET)) {
    throw new HttpError(403, 'Setup secret is invalid.');
  }

  const data = validate(body, SETUP_RULES);
  if (data.password !== data.confirm_password) {
    throw new HttpError(400, 'Please check the highlighted fields.', {
      confirm_password: 'Passwords do not match.'
    });
  }

  const email = data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(data.password);

  const placeholder = await db.get(
    'SELECT id FROM users WHERE farm_id = ? AND password_hash IS NULL LIMIT 1',
    [FARM_ID]
  );

  let userId;
  try {
    if (placeholder) {
      await db.run('UPDATE users SET email = ?, name = ?, password_hash = ?, role = ?, updated_at = ? WHERE id = ?', [
        email,
        data.name,
        passwordHash,
        'owner',
        db.now(),
        placeholder.id
      ]);
      userId = placeholder.id;
    } else {
      const info = await db.run(
        'INSERT INTO users (farm_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [FARM_ID, email, data.name, passwordHash, 'owner']
      );
      userId = info.lastInsertRowid;
    }
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, 'An owner account already exists.');
    }
    throw err;
  }

  if (data.farm_name && data.farm_name.trim()) {
    await db.run('UPDATE farms SET name = ?, updated_at = ? WHERE id = ?', [data.farm_name.trim(), db.now(), FARM_ID]);
  }

  const token = await createSession(userId);
  return { token, user: { id: userId, name: data.name, email, role: 'owner' } };
}

const LOGIN_RULES = {
  email: { required: true, label: 'Email' },
  password: { required: true, label: 'Password' }
};

async function login(body) {
  const data = validate(body, LOGIN_RULES);
  const email = data.email.trim().toLowerCase();
  const row = await db.get('SELECT id, email, name, role, password_hash FROM users WHERE email = ?', [email]);

  let passwordOk = false;
  if (row && row.password_hash) {
    passwordOk = await verify(row.password_hash, data.password);
  } else {
    // Equalize timing when the user does not exist.
    await verify(await dummyHash(), data.password);
  }

  if (!passwordOk) {
    throw new HttpError(401, LOGIN_ERROR);
  }

  const token = await createSession(row.id);
  return { token, user: { id: row.id, name: row.name, email: row.email, role: row.role } };
}

module.exports = { status, setup, login, logout, userForToken, hasOwner };

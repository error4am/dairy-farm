const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-auth-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.AUTH_ENABLED = 'true';
process.env.LOGIN_MAX_ATTEMPTS = '5';
const LOGIN_WINDOW_MS = 4000;
process.env.LOGIN_WINDOW_MS = String(LOGIN_WINDOW_MS);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

require('../db/seed')();

const app = require('../index');
const connection = require('../db/connection');

let server = null;
let base = '';

const jar = new Map();

function parseSetCookie(setCookie) {
  const parts = setCookie.split(';').map((part) => part.trim());
  const eq = parts[0].indexOf('=');
  return {
    name: parts[0].slice(0, eq),
    value: parts[0].slice(eq + 1),
    attrs: parts.slice(1)
  };
}

async function req(method, urlPath, body) {
  const headers = { 'Content-Type': 'application/json' };
  const cookieParts = [];
  for (const [key, value] of jar) {
    if (value) cookieParts.push(`${key}=${value}`);
  }
  if (cookieParts.length > 0) headers['Cookie'] = cookieParts.join('; ');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && jar.get('dairy_csrf')) {
    headers['X-CSRF-Token'] = jar.get('dairy_csrf');
  }

  const res = await fetch(base + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const setCookie of setCookies) {
    const parsed = parseSetCookie(setCookie);
    if (parsed.value === '' || /expires=thu, 01 jan 1970/i.test(setCookie)) {
      jar.delete(parsed.name);
    } else {
      jar.set(parsed.name, parsed.value);
    }
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, data, setCookies, raw: text };
}

async function login(email, password) {
  return req('POST', '/api/auth/login', { email, password });
}

const OWNER_EMAIL = 'adil123@gmail.com';
const OWNER_PASSWORD = 'DairyPass123';

test('start server on an ephemeral port', async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

test('status reports auth enabled and setup required before any owner exists', async () => {
  const res = await req('GET', '/api/auth/status');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { auth_enabled: true, setup_required: true });
  assert.ok(jar.has('dairy_csrf'), 'status issues the CSRF cookie');
});

test('setup rejects invalid email, weak password and mismatched confirmation', async () => {
  const badEmail = await req('POST', '/api/auth/setup', {
    name: 'Adil',
    email: 'not-an-email',
    password: OWNER_PASSWORD,
    confirm_password: OWNER_PASSWORD
  });
  assert.equal(badEmail.status, 400);
  assert.ok(badEmail.data.details && badEmail.data.details.email, 'email field error');

  const weakPassword = await req('POST', '/api/auth/setup', {
    name: 'Adil',
    email: OWNER_EMAIL,
    password: 'short1',
    confirm_password: 'short1'
  });
  assert.equal(weakPassword.status, 400);
  assert.ok(weakPassword.data.details && weakPassword.data.details.password, 'password field error');

  const mismatch = await req('POST', '/api/auth/setup', {
    name: 'Adil',
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    confirm_password: 'SomethingElse1'
  });
  assert.equal(mismatch.status, 400);
  assert.ok(mismatch.data.details && mismatch.data.details.confirm_password, 'confirm field error');
});

test('setup creates the owner with a dummy email and starts an authenticated session', async () => {
  const res = await req('POST', '/api/auth/setup', {
    name: 'Adil',
    farm_name: 'Al-Noor Dairy Farm',
    email: OWNER_EMAIL,
    password: OWNER_PASSWORD,
    confirm_password: OWNER_PASSWORD
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.user.name, 'Adil');
  assert.equal(res.data.user.email, OWNER_EMAIL);
  assert.equal(res.data.user.role, 'owner');
  assert.ok(jar.has('dairy_session'), 'session cookie issued');
  assert.ok(!('token' in res.data), 'no token exposed in the response body');

  const me = await req('GET', '/api/auth/me');
  assert.equal(me.data.authenticated, true);
});

test('duplicate owner setup is rejected', async () => {
  const res = await req('POST', '/api/auth/setup', {
    name: 'Someone Else',
    email: 'other@example.com',
    password: 'AnotherPass1',
    confirm_password: 'AnotherPass1'
  });
  assert.equal(res.status, 409);
});

test('password is stored as an Argon2id hash and never in plaintext', () => {
  const row = connection
    .prepare('SELECT password_hash FROM users WHERE email = ?')
    .get(OWNER_EMAIL);
  assert.ok(row, 'owner row exists');
  assert.ok(row.password_hash.startsWith('$argon2id$'), 'Argon2id PHC hash');
  assert.ok(!row.password_hash.includes(OWNER_PASSWORD), 'plaintext password never stored');
});

test('login with a wrong password returns the generic error', async () => {
  const res = await login(OWNER_EMAIL, 'WrongPassword1');
  assert.equal(res.status, 401);
  assert.deepEqual(res.data, { error: 'Invalid email or password.' });
});

test('login with an unknown email returns the same generic error', async () => {
  const res = await login('nobody@example.com', 'Whatever123');
  assert.equal(res.status, 401);
  assert.deepEqual(res.data, { error: 'Invalid email or password.' });
});

test('correct login issues an HttpOnly, SameSite=Lax session cookie and never exposes the token', async () => {
  const res = await login(OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(res.status, 200);
  assert.equal(res.data.user.email, OWNER_EMAIL);

  const sessionCookie = res.setCookies.find((setCookie) => setCookie.startsWith('dairy_session='));
  assert.ok(sessionCookie, 'session cookie set');
  assert.match(sessionCookie, /HttpOnly/i, 'cookie is HttpOnly');
  assert.match(sessionCookie, /SameSite=Lax/i, 'cookie is SameSite=Lax');
  assert.ok(!/token/.test(res.raw), 'no session token in the JSON body');
});

test('/me returns the owner without sensitive fields', async () => {
  const res = await req('GET', '/api/auth/me');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, {
    authenticated: true,
    user: { id: 1, name: 'Adil', email: OWNER_EMAIL, role: 'owner' }
  });
  assert.ok(!/password/.test(res.raw), 'no password material in the response');
});

test('protected farm API returns 401 without a session and works with one', async () => {
  await req('POST', '/api/auth/logout');
  const loggedOut = await req('GET', '/api/animals');
  assert.equal(loggedOut.status, 401);
  assert.deepEqual(loggedOut.data, { error: 'Unauthorized' });

  const signedIn = await login(OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(signedIn.status, 200);

  const animals = await req('GET', '/api/animals');
  assert.equal(animals.status, 200);
});

test('health endpoint stays public without authentication', async () => {
  const res = await req('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { status: 'ok', database: 'ok' });
});

test('mutating farm requests require a valid CSRF token', async () => {
  jar.delete('dairy_csrf');

  const withoutToken = await req('POST', '/api/animals', {
    tag_number: 'AUTH-1',
    type: 'cow',
    gender: 'female'
  });
  assert.equal(withoutToken.status, 403, 'missing CSRF token is rejected');
  assert.deepEqual(withoutToken.data, { error: 'Invalid CSRF token.' });

  await req('GET', '/api/auth/status');
  const withToken = await req('POST', '/api/animals', {
    tag_number: 'AUTH-1',
    type: 'cow',
    gender: 'female'
  });
  assert.equal(withToken.status, 201, 'valid CSRF token accepted');
  assert.equal(withToken.data.tag_number, 'AUTH-1');
});

test('existing farm modules keep working after authentication', async () => {
  const animals = await req('GET', '/api/animals');
  const animal = animals.data.find((item) => item.tag_number === 'AUTH-1');
  assert.ok(animal, 'animal created earlier is listed');

  const milk = await req('POST', '/api/milk-records', {
    animal_id: animal.id,
    date: new Date().toISOString().slice(0, 10),
    session: 'morning',
    quantity: 8,
    unit: 'L'
  });
  assert.equal(milk.status, 201, JSON.stringify(milk.data));

  const dashboard = await req('GET', '/api/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.metrics.active_animals, 1);

  const meta = await req('GET', '/api/meta');
  assert.equal(meta.status, 200);
  assert.equal(meta.data.farm.name, 'Al-Noor Dairy Farm');
});

test('logout destroys the session', async () => {
  connection.prepare('DELETE FROM sessions').run();

  const signedIn = await login(OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(signedIn.status, 200);
  const before = connection.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  assert.equal(before, 1, 'exactly one session exists before logout');

  const res = await req('POST', '/api/auth/logout');
  assert.equal(res.status, 200);

  const afterLogout = connection.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  assert.equal(afterLogout, 0, 'session row removed');

  const me = await req('GET', '/api/auth/me');
  assert.deepEqual(me.data, { authenticated: false });
});

test('milk sales API requires a session', async () => {
  const listed = await req('GET', '/api/milk-sales');
  assert.equal(listed.status, 401, 'milk sales list requires a session');

  const created = await req('POST', '/api/milk-prices', { price_per_litre: 200, effective_date: '2026-01-15' });
  assert.equal(created.status, 401, 'milk price creation requires a session');

  const signedIn = await login(OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(signedIn.status, 200, 'owner can log back in');

  const prices = await req('GET', '/api/milk-prices');
  assert.equal(prices.status, 200, 'milk prices are readable after login');
  const sales = await req('GET', '/api/milk-sales');
  assert.equal(sales.status, 200, 'milk sales are readable after login');
  assert.equal(Array.isArray(sales.data.items), true, 'the sales payload keeps its shape');
});

test('expired sessions are rejected', async () => {
  const token = 'expired-session-token-for-testing';
  const id = crypto.createHash('sha256').update(token).digest('hex');
  connection
    .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .run(id, 1, '2000-01-01T00:00:00.000Z');

  jar.set('dairy_session', token);
  const me = await req('GET', '/api/auth/me');
  assert.deepEqual(me.data, { authenticated: false });

  const animals = await req('GET', '/api/animals');
  assert.equal(animals.status, 401, 'expired session cannot access the farm API');

  jar.delete('dairy_session');
});

test('login rate limiting counts failures, resets on success and blocks after the threshold', async () => {
  const firstFailure = await login('brute@example.com', 'WrongPasswordA');
  assert.equal(firstFailure.status, 401);

  const successResets = await login(OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(successResets.status, 200, 'success below the limit resets the counter');

  for (let i = 0; i < 5; i += 1) {
    const res = await login('brute@example.com', 'WrongPassword' + i);
    assert.equal(res.status, 401, `failure ${i + 1} allowed after reset`);
  }

  const blocked = await login('brute@example.com', 'WrongPasswordX');
  assert.equal(blocked.status, 429, 'sixth failure is rate limited');

  const blockedCorrect = await login(OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(blockedCorrect.status, 429, 'blocked IP is rejected before verification');

  await sleep(LOGIN_WINDOW_MS + 500);
  const recovered = await login(OWNER_EMAIL, OWNER_PASSWORD);
  assert.equal(recovered.status, 200, 'window expiry resets the limit');
});

after(async () => {
  if (server) {
    server.close();
    await once(server, 'close').catch(() => {});
  }
  if (connection.open) connection.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

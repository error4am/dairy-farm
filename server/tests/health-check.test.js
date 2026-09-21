const os = require('os');
const path = require('path');
const fs = require('fs');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-health-check-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../index');
const connection = require('../db/connection');

let server = null;
let base = '';

test('start server on an ephemeral port', async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

test('health endpoint reports the server and database as healthy', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.deepEqual(body, { status: 'ok', database: 'ok' });
});

test('health endpoint exposes no paths, credentials or stack traces', async () => {
  const res = await fetch(`${base}/api/health`);
  const text = await res.text();
  assert.ok(!/dbPath|DB_PATH|password|postgres|sqlite|stack|at Object|\\\\|\/data\//i.test(text), text);
});

test('health endpoint returns 503 when the database is unavailable', async () => {
  connection.close();

  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 503);

  const body = await res.json();
  assert.deepEqual(body, { status: 'error', database: 'error' });
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

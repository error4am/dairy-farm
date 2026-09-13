const os = require('os');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

let child = null;
let dbPath = null;

test('production server binds to 127.0.0.1 only, not all interfaces', async () => {
  const port = await freePort();
  dbPath = path.join(os.tmpdir(), `dairy-bind-test-${process.pid}-${Date.now()}.db`);

  child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.resume();

  const ready = await waitForHealth(port);
  assert.ok(ready, `server did not start on 127.0.0.1:${port}. stderr: ${stderr}`);

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 200, 'IPv4 loopback must be reachable');
  const body = await health.json();
  assert.equal(body.status, 'ok');

  await assert.rejects(
    fetch(`http://[::1]:${port}/api/health`, { signal: AbortSignal.timeout(1500) }),
    (err) => err instanceof Error,
    'IPv6 loopback must be refused — accepting it would mean the server is bound to all interfaces'
  );

  const lanAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && !iface.internal && iface.family === 'IPv4');

  for (const iface of lanAddresses) {
    await assert.rejects(
      fetch(`http://${iface.address}:${port}/api/health`, { signal: AbortSignal.timeout(1500) }),
      (err) => err instanceof Error,
      `LAN address ${iface.address} must not be reachable`
    );
  }
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, 'exit').catch(() => {});
  }
  if (dbPath) {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
  }
});

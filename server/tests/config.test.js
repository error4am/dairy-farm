const path = require('path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveHost, resolveOrigins } = require('../config');

test('host defaults to loopback locally and all interfaces in production', () => {
  assert.equal(resolveHost({}, false), '127.0.0.1');
  assert.equal(resolveHost({}, true), '0.0.0.0');
  assert.equal(resolveHost({ HOST: '127.0.0.1' }, true), '127.0.0.1');
  assert.equal(resolveHost({ HOST: '0.0.0.0' }, false), '0.0.0.0');
});

test('CORS origins come from FRONTEND_ORIGIN with local development defaults', () => {
  assert.deepEqual(resolveOrigins({ FRONTEND_ORIGIN: 'https://farm.example.com' }, true), [
    'https://farm.example.com'
  ]);
  assert.deepEqual(resolveOrigins({ FRONTEND_ORIGIN: 'https://a.example.com, https://b.example.com' }, true), [
    'https://a.example.com',
    'https://b.example.com'
  ]);
  assert.deepEqual(resolveOrigins({}, true), [], 'production must not allow wildcard or implicit origins');

  const development = resolveOrigins({}, false);
  assert.ok(development.includes('http://localhost:5173'));
  assert.ok(development.includes('http://127.0.0.1:5173'));
  assert.ok(!development.includes('*'), 'wildcard origins are never allowed');
});

test('production without DATABASE_URL or DB_PATH fails clearly at startup', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./config')"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: '', DB_PATH: '' },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0, 'production configuration must fail without a database');
  assert.match(result.stderr, /DATABASE_URL/);
  assert.match(result.stderr, /DB_PATH/);
});

test('production with DATABASE_URL loads successfully', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./config')"], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/dairy',
      DB_PATH: ''
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
});

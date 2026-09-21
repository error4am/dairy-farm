const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { migrate, seed, MIGRATIONS_DIR } = require('../db/pgInit');

function createFakeDriver() {
  const state = {
    applied: new Set(),
    execs: [],
    runs: [],
    farms: 0,
    users: 0,
    inTransaction: 0
  };

  const driver = {
    nowDefault: "datetime('now')",
    async exec(sql) {
      state.execs.push(sql);
    },
    async all(sql) {
      if (/FROM schema_migrations/i.test(sql)) return [...state.applied].map((name) => ({ name }));
      return [];
    },
    async get(sql) {
      if (/COUNT\(\*\).*FROM farms/i.test(sql)) return { n: state.farms };
      return undefined;
    },
    async run(sql, params = []) {
      state.runs.push({ sql, params });
      if (/INSERT INTO schema_migrations/i.test(sql)) state.applied.add(params[0]);
      if (/INSERT INTO farms/i.test(sql)) {
        state.farms += 1;
        return { lastInsertRowid: 1, changes: 1 };
      }
      if (/INSERT INTO users/i.test(sql)) {
        state.users += 1;
        return { lastInsertRowid: 1, changes: 1 };
      }
      return { lastInsertRowid: 1, changes: 1 };
    },
    async transaction(fn) {
      state.inTransaction += 1;
      try {
        return await fn({
          exec: (sql) => driver.exec(sql),
          all: (sql) => driver.all(sql),
          get: (sql) => driver.get(sql),
          run: (sql, params) => driver.run(sql, params)
        });
      } finally {
        state.inTransaction -= 1;
      }
    }
  };

  return { driver, state };
}

const sqliteMigrationNames = fs
  .readdirSync(path.join(__dirname, '..', 'db', 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();

test('PostgreSQL migrations mirror the SQLite migration history exactly', () => {
  const pgNames = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  assert.deepEqual(pgNames, sqliteMigrationNames);
});

test('migrate applies every migration once, in order, inside a transaction', async () => {
  const { driver, state } = createFakeDriver();

  await migrate(driver);

  assert.deepEqual([...state.applied].sort(), sqliteMigrationNames);
  assert.equal(state.inTransaction, 0, 'transactions must be closed');

  const recorded = state.runs.filter((run) => /INSERT INTO schema_migrations/i.test(run.sql)).map((run) => run.params[0]);
  assert.deepEqual(recorded, sqliteMigrationNames, 'migrations applied in sorted order');

  const tracked = state.execs.filter((sql) => /CREATE TABLE IF NOT EXISTS schema_migrations/i.test(sql));
  assert.equal(tracked.length, 1, 'migration tracking table created once');
});

test('migrate skips migrations that were already applied', async () => {
  const { driver, state } = createFakeDriver();

  await migrate(driver);
  const afterFirst = state.runs.length;
  const execsAfterFirst = state.execs.length;

  await migrate(driver);

  assert.equal(state.runs.length, afterFirst, 'no migration rows inserted on the second run');
  const newExecs = state.execs.slice(execsAfterFirst);
  assert.equal(newExecs.length, 1, 'only the idempotent tracking-table statement may run again');
  assert.match(newExecs[0], /CREATE TABLE IF NOT EXISTS schema_migrations/i);
  assert.equal(
    newExecs.some((sql) => /CREATE TABLE IF NOT EXISTS farms/i.test(sql)),
    false,
    'applied migration SQL must not be executed again'
  );
});

test('seed creates the default farm and owner only when the database is empty', async () => {
  const { driver, state } = createFakeDriver();

  await seed(driver);
  assert.equal(state.farms, 1);
  assert.equal(state.users, 1);

  await seed(driver);
  assert.equal(state.farms, 1, 'seed must not duplicate the farm');
  assert.equal(state.users, 1);
});

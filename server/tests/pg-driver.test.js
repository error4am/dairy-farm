const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

const { createPgDriver } = require('../db/pgDriver');

const mem = newDb();
mem.public.registerFunction({
  name: 'substr',
  args: [DataType.text, DataType.integer, DataType.integer],
  returns: DataType.text,
  implementation: (value, from, length) => String(value).substr(from - 1, length)
});

const { Pool } = mem.adapters.createPg();
const pool = new Pool();
const driver = createPgDriver({ pool });

mem.public.none(`
  CREATE TABLE farms (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE animals (
    id SERIAL PRIMARY KEY,
    farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    tag_number TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT '',
    UNIQUE (farm_id, tag_number)
  );
  CREATE TABLE milk_records (
    id SERIAL PRIMARY KEY,
    farm_id INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    animal_id INTEGER NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    date TEXT NOT NULL,
    session TEXT NOT NULL CHECK (session IN ('morning', 'evening')),
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0)
  );
`);

driver.run('INSERT INTO farms (name) VALUES (?)', ['Test Farm']);

function createMockPool() {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ target: 'client', text, params });
      return { rows: [], rowCount: 0 };
    },
    release: () => calls.push({ target: 'release' })
  };
  return {
    calls,
    pool: {
      connect: async () => client,
      query: async (text, params) => {
        calls.push({ target: 'pool', text, params });
        return { rows: [], rowCount: 0 };
      },
      end: async () => {}
    }
  };
}

test('insert returns a numeric id and change count', async () => {
  const info = await driver.run('INSERT INTO animals (farm_id, tag_number) VALUES (?, ?)', [1, 'PG-A']);
  assert.equal(typeof info.lastInsertRowid, 'number');
  assert.ok(info.lastInsertRowid > 0);
  assert.equal(info.changes, 1);
});

test('get and all use positional placeholders correctly', async () => {
  await driver.run('INSERT INTO animals (farm_id, tag_number) VALUES (?, ?)', [1, 'PG-B']);

  const one = await driver.get('SELECT * FROM animals WHERE farm_id = ? AND tag_number = ?', [1, 'PG-B']);
  assert.equal(one.tag_number, 'PG-B');
  assert.equal(one.active, 1);

  const all = await driver.all('SELECT * FROM animals WHERE farm_id = ? ORDER BY id', [1]);
  assert.ok(all.length >= 2);
});

test('question marks inside literals are not treated as placeholders', async () => {
  const row = await driver.get("SELECT 'a?b' AS literal, ? AS param", ['value']);
  assert.equal(row.literal, 'a?b');
  assert.equal(row.param, 'value');
});

test('transactions run on one dedicated client in BEGIN/COMMIT/ROLLBACK order', async () => {
  const mock = createMockPool();
  const mockDriver = createPgDriver({ pool: mock.pool });

  await mockDriver.transaction(async (tx) => {
    await tx.run('INSERT INTO animals (farm_id, tag_number) VALUES (?, ?)', [1, 'M-1']);
    await tx.get('SELECT * FROM animals WHERE id = ?', [1]);
  });

  const committed = mock.calls.map((call) => call.text).filter(Boolean);
  assert.deepEqual(committed, [
    'BEGIN',
    'INSERT INTO animals (farm_id, tag_number) VALUES ($1, $2) RETURNING id',
    'SELECT * FROM animals WHERE id = $1',
    'COMMIT'
  ]);
  assert.equal(mock.calls.every((call) => call.target !== 'pool'), true, 'transaction must not use the pool directly');
  assert.equal(mock.calls[mock.calls.length - 1].target, 'release');

  mock.calls.length = 0;

  await assert.rejects(
    mockDriver.transaction(async (tx) => {
      await tx.run('INSERT INTO animals (farm_id, tag_number) VALUES (?, ?)', [1, 'M-2']);
      throw new Error('boom');
    }),
    /boom/
  );

  const rolledBack = mock.calls.map((call) => call.text).filter(Boolean);
  assert.deepEqual(rolledBack, ['BEGIN', 'INSERT INTO animals (farm_id, tag_number) VALUES ($1, $2) RETURNING id', 'ROLLBACK']);
  assert.equal(mock.calls[mock.calls.length - 1].target, 'release');
});

test('module level queries inside a transaction use the transaction client', async () => {
  const mock = createMockPool();
  const mockDriver = createPgDriver({ pool: mock.pool });

  await mockDriver.transaction(async () => {
    await mockDriver.run('UPDATE animals SET tag_number = ? WHERE id = ?', ['X', 1]);
  });

  const statements = mock.calls.map((call) => call.text).filter(Boolean);
  assert.deepEqual(statements, ['BEGIN', 'UPDATE animals SET tag_number = $1 WHERE id = $2', 'COMMIT']);
  assert.equal(mock.calls.every((call) => call.target !== 'pool'), true);
});

test('queries outside a transaction use the pool', async () => {
  const mock = createMockPool();
  const mockDriver = createPgDriver({ pool: mock.pool });

  await mockDriver.get('SELECT 1 AS ok');

  assert.deepEqual(mock.calls, [{ target: 'pool', text: 'SELECT 1 AS ok', params: [] }]);
});

test('unique violations are classified and synthetic constraint codes are recognised', async () => {
  let uniqueError = null;
  try {
    await driver.run('INSERT INTO animals (farm_id, tag_number) VALUES (?, ?)', [1, 'PG-A']);
  } catch (err) {
    uniqueError = err;
  }
  assert.ok(uniqueError, 'duplicate tag must fail');
  assert.equal(driver.isUniqueViolation(uniqueError), true);
  assert.equal(driver.isConstraintViolation(uniqueError), true);

  assert.equal(driver.isConstraintViolation({ code: '23514' }), true, 'check violation');
  assert.equal(driver.isConstraintViolation({ code: '23503' }), true, 'foreign key violation');
  assert.equal(driver.isConstraintViolation({ code: '42P01' }), false, 'undefined table is not a constraint error');
  assert.equal(driver.isUniqueViolation({ code: '23503' }), false);
  assert.equal(driver.isUniqueViolation(null), false);
});

test('portable SQL patterns used by the services work on PostgreSQL', async () => {
  const substr = await driver.get('SELECT substr(?, 1, 7) AS month', ['2026-09-21']);
  assert.equal(substr.month, '2026-09');

  const count = await driver.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM animals');
  assert.equal(typeof count.n, 'number');

  const lower = await driver.all('SELECT tag_number FROM animals ORDER BY LOWER(tag_number)');
  assert.equal(lower.length > 0, true);

  const cast = await driver.get('SELECT CAST(? AS INTEGER) AS n', ['7']);
  assert.equal(cast.n, 7);
});

test('ping reports a healthy connection', async () => {
  assert.equal(await driver.ping(), true);
});

after(async () => {
  await driver.close();
});

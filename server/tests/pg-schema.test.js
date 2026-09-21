const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.tmpdir(), `dairy-pg-schema-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();
const connection = require('../db/connection');

const PG_DIR = path.join(__dirname, '..', 'db', 'pg', 'migrations');

function readSqliteSchema() {
  const tables = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name)
    .filter((name) => name !== 'schema_migrations')
    .sort();

  const columns = {};
  const foreignKeys = {};
  const uniques = {};
  for (const table of tables) {
    columns[table] = connection
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name)
      .sort();
    foreignKeys[table] = connection.prepare(`PRAGMA foreign_key_list(${table})`).all().length;
    uniques[table] = connection
      .prepare(`PRAGMA index_list(${table})`)
      .all()
      .filter((row) => row.origin === 'u').length;
  }

  const indexes = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%'")
    .all()
    .map((row) => row.name)
    .sort();

  return { tables, columns, foreignKeys, uniques, indexes };
}

function readPgSchema() {
  const files = fs
    .readdirSync(PG_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const tables = new Map();
  const indexes = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(PG_DIR, file), 'utf8');

    const createRe = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g;
    let match;
    while ((match = createRe.exec(sql))) {
      const name = match[1];
      const body = match[2];
      const columns = [];
      let uniqueCount = 0;

      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        if (/^UNIQUE\b/i.test(line)) {
          uniqueCount += 1;
          continue;
        }
        if (/^(PRIMARY KEY|CHECK|FOREIGN KEY|CONSTRAINT)\b/i.test(line)) continue;
        const column = /^([a-z_][a-z0-9_]*)\s+/i.exec(line);
        if (column) columns.push(column[1]);
      }

      const foreignKeys = (body.match(/\bREFERENCES\b/g) || []).length;
      tables.set(name, { columns, foreignKeys, uniques: uniqueCount });
    }

    const alterRe = /ALTER TABLE (\w+) ADD COLUMN (\w+)/g;
    while ((match = alterRe.exec(sql))) {
      if (!tables.has(match[1])) tables.set(match[1], { columns: [], foreignKeys: 0, uniques: 0 });
      tables.get(match[1]).columns.push(match[2]);
    }

    const indexRe = /CREATE INDEX IF NOT EXISTS (\w+)/g;
    while ((match = indexRe.exec(sql))) indexes.push(match[1]);
  }

  const sortedTables = [...tables.keys()].sort();
  const columns = {};
  const foreignKeys = {};
  const uniques = {};
  for (const table of sortedTables) {
    columns[table] = tables.get(table).columns.slice().sort();
    foreignKeys[table] = tables.get(table).foreignKeys;
    uniques[table] = tables.get(table).uniques;
  }

  return { tables: sortedTables, columns, foreignKeys, uniques, indexes: indexes.sort() };
}

const sqlite = readSqliteSchema();
const postgres = readPgSchema();

test('PostgreSQL migrations define exactly the same tables as SQLite', () => {
  assert.deepEqual(postgres.tables, sqlite.tables);
});

test('PostgreSQL tables have exactly the same columns as SQLite', () => {
  for (const table of sqlite.tables) {
    assert.deepEqual(postgres.columns[table], sqlite.columns[table], `column mismatch on ${table}`);
  }
});

test('PostgreSQL tables preserve foreign key and unique constraint counts', () => {
  for (const table of sqlite.tables) {
    assert.equal(postgres.foreignKeys[table], sqlite.foreignKeys[table], `foreign key mismatch on ${table}`);
    assert.equal(postgres.uniques[table], sqlite.uniques[table], `unique constraint mismatch on ${table}`);
  }
});

test('PostgreSQL migrations define the same explicit indexes as SQLite', () => {
  assert.deepEqual(postgres.indexes, sqlite.indexes);
});

after(() => {
  connection.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

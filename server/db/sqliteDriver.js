'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const connection = require('./connection');

const txStorage = new AsyncLocalStorage();
let queue = Promise.resolve();

function enqueue(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function allSync(sql, params = []) {
  return connection.prepare(sql).all(...params);
}

function getSync(sql, params = []) {
  return connection.prepare(sql).get(...params);
}

function runSync(sql, params = []) {
  const info = connection.prepare(sql).run(...params);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

function guarded(operation) {
  return (sql, params = []) => {
    if (txStorage.getStore()) return operation(sql, params);
    return enqueue(() => operation(sql, params));
  };
}

const all = guarded(allSync);
const get = guarded(getSync);
const run = guarded(runSync);

async function transaction(fn) {
  return enqueue(async () => {
    connection.exec('BEGIN');
    const tx = {
      all: async (sql, params = []) => allSync(sql, params),
      get: async (sql, params = []) => getSync(sql, params),
      run: async (sql, params = []) => runSync(sql, params),
      exec: async (sql) => connection.exec(sql)
    };
    try {
      const result = await txStorage.run({ transaction: true }, () => fn(tx));
      connection.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        connection.exec('ROLLBACK');
      } catch {
        // rollback failures must not mask the original error
      }
      throw err;
    }
  });
}

async function exec(sql) {
  return enqueue(() => connection.exec(sql));
}

async function ping() {
  try {
    const row = await get('SELECT 1 AS ok');
    return row && row.ok === 1;
  } catch {
    return false;
  }
}

async function close() {
  if (connection.open) connection.close();
}

function isUniqueViolation(err) {
  return Boolean(err) && err.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function isConstraintViolation(err) {
  return Boolean(err) && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT');
}

module.exports = {
  dialect: 'sqlite',
  isPostgres: false,
  nowDefault: "datetime('now')",
  all,
  get,
  run,
  exec,
  transaction,
  ping,
  close,
  now,
  isUniqueViolation,
  isConstraintViolation
};

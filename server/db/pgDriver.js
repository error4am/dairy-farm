'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { convertPlaceholders, withReturningId, isInsert } = require('./sql');

function createPgDriver(options = {}) {
  const txStorage = new AsyncLocalStorage();
  const pool = options.pool || createPool(options);

  function createPool(opts) {
    const { Pool } = require('pg');
    return new Pool({ connectionString: opts.connectionString, connectionTimeoutMillis: 10000 });
  }

  function executor() {
    return txStorage.getStore() || pool;
  }

  async function all(sql, params = []) {
    const result = await executor().query(convertPlaceholders(sql), params);
    return result.rows;
  }

  async function get(sql, params = []) {
    const result = await executor().query(convertPlaceholders(sql), params);
    return result.rows[0];
  }

  async function run(sql, params = []) {
    const returningId = isInsert(sql);
    const text = withReturningId(convertPlaceholders(sql));
    const result = await executor().query(text, params);
    return {
      changes: result.rowCount,
      lastInsertRowid: returningId && result.rows[0] ? result.rows[0].id : null
    };
  }

  async function transaction(fn) {
    const client = await pool.connect();
    const tx = {
      all: async (sql, params = []) => (await client.query(convertPlaceholders(sql), params)).rows,
      get: async (sql, params = []) => (await client.query(convertPlaceholders(sql), params)).rows[0],
      run: async (sql, params = []) => {
        const returningId = isInsert(sql);
        const result = await client.query(withReturningId(convertPlaceholders(sql)), params);
        return {
          changes: result.rowCount,
          lastInsertRowid: returningId && result.rows[0] ? result.rows[0].id : null
        };
      },
      exec: async (sql) => client.query(sql)
    };

    try {
      await client.query('BEGIN');
      const result = await txStorage.run(client, () => fn(tx));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // rollback failures must not mask the original error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async function exec(sql) {
    await pool.query(sql);
  }

  async function ping() {
    try {
      await pool.query('SELECT 1 AS ok');
      return true;
    } catch {
      return false;
    }
  }

  async function close() {
    await pool.end();
  }

  function isUniqueViolation(err) {
    return Boolean(err) && err.code === '23505';
  }

  function isConstraintViolation(err) {
    return Boolean(err) && typeof err.code === 'string' && err.code.startsWith('23');
  }

  function now() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  return {
    dialect: 'postgres',
    isPostgres: true,
    nowDefault: "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')",
    pool,
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
}

module.exports = { createPgDriver };

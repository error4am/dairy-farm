'use strict';

const config = require('../config');

let driver = null;
let readyPromise = null;

function defaultDriver() {
  if (config.IS_POSTGRES) {
    const { createPgDriver } = require('./pgDriver');
    return createPgDriver({ connectionString: config.DATABASE_URL });
  }
  return require('./sqliteDriver');
}

function getDriver() {
  if (!driver) driver = defaultDriver();
  return driver;
}

function setDriver(next) {
  driver = next;
  readyPromise = null;
}

async function ready() {
  const active = getDriver();
  if (!active.isPostgres) return;
  if (!readyPromise) {
    const { initPostgres } = require('./pgInit');
    readyPromise = initPostgres(active);
  }
  return readyPromise;
}

module.exports = {
  get dialect() {
    return getDriver().dialect;
  },
  get isPostgres() {
    return getDriver().isPostgres;
  },
  get nowDefault() {
    return getDriver().nowDefault;
  },
  all: (sql, params) => getDriver().all(sql, params),
  get: (sql, params) => getDriver().get(sql, params),
  run: (sql, params) => getDriver().run(sql, params),
  exec: (sql) => getDriver().exec(sql),
  transaction: (fn) => getDriver().transaction(fn),
  ping: () => getDriver().ping(),
  close: () => getDriver().close(),
  now: () => getDriver().now(),
  isUniqueViolation: (err) => getDriver().isUniqueViolation(err),
  isConstraintViolation: (err) => getDriver().isConstraintViolation(err),
  ready,
  setDriver
};

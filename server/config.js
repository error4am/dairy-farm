'use strict';

const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const DATABASE_URL = process.env.DATABASE_URL || '';
const IS_POSTGRES = Boolean(DATABASE_URL);

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dairy.db');

if (IS_PRODUCTION && !IS_POSTGRES && !process.env.DB_PATH) {
  throw new Error(
    'Production mode requires DATABASE_URL (online/PostgreSQL) or DB_PATH (local SQLite edition). ' +
      'Set DATABASE_URL for the online deployment or DB_PATH for the desktop edition.'
  );
}

function resolveHost(env = process.env, production = IS_PRODUCTION) {
  if (env.HOST) return env.HOST;
  return production ? '0.0.0.0' : '127.0.0.1';
}

function resolveOrigins(env = process.env, production = IS_PRODUCTION) {
  const configured = String(env.FRONTEND_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  if (!production) {
    return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }
  return [];
}

module.exports = {
  NODE_ENV,
  IS_PRODUCTION,
  IS_POSTGRES,
  DATABASE_URL,
  PORT: Number(process.env.PORT) || 4000,
  HOST: resolveHost(),
  FARM_ID: 1,
  DB_PATH,
  BACKUP_DIR: process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups'),
  CLIENT_DIST: path.join(__dirname, '..', 'client', 'dist'),
  FRONTEND_ORIGINS: resolveOrigins(),
  resolveHost,
  resolveOrigins
};

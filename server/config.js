const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dairy.db');

module.exports = {
  PORT: Number(process.env.PORT) || 4000,
  HOST: process.env.HOST || '127.0.0.1',
  FARM_ID: 1,
  DB_PATH,
  BACKUP_DIR: process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups'),
  CLIENT_DIST: path.join(__dirname, '..', 'client', 'dist')
};

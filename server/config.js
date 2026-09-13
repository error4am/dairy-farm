const path = require('path');

module.exports = {
  PORT: Number(process.env.PORT) || 4000,
  HOST: process.env.HOST || '127.0.0.1',
  FARM_ID: 1,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dairy.db'),
  CLIENT_DIST: path.join(__dirname, '..', 'client', 'dist')
};

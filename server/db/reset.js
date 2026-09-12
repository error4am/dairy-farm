const fs = require('fs');
const { DB_PATH } = require('../config');

for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(DB_PATH + suffix, { force: true });
}

require('./seed');
console.log('Database reset.');

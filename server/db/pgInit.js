'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'pg', 'migrations');

async function migrate(driver) {
  await driver.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (${driver.nowDefault})
    )`
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied = new Set((await driver.all('SELECT name FROM schema_migrations')).map((row) => row.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await driver.transaction(async (tx) => {
      await tx.exec(sql);
      // schema_migrations has no `id` column, so the record must be inserted without
      // the driver's INSERT...RETURNING id behaviour (tx.run appends it).
      await tx.all('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    });
    console.log('Applied PostgreSQL migration: ' + file);
  }
}

async function seed(driver) {
  const row = await driver.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM farms');
  if (row.n === 0) {
    const info = await driver.run(
      'INSERT INTO farms (name, currency, milk_unit, week_start) VALUES (?, ?, ?, ?)',
      ['My Dairy Farm', 'PKR', 'L', 'monday']
    );
    await driver.run('INSERT INTO users (farm_id, name, email) VALUES (?, ?, ?)', [
      info.lastInsertRowid,
      'Farm Owner',
      null
    ]);
    console.log('Seeded default farm (PostgreSQL).');
  }
}

async function initPostgres(driver) {
  await migrate(driver);
  await seed(driver);
}

module.exports = { migrate, seed, initPostgres, MIGRATIONS_DIR };

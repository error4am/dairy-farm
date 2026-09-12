const fs = require('fs');
const path = require('path');
const db = require('./connection');

function migrate() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`
  );

  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    });
    run();
    console.log('Applied migration: ' + file);
  }
}

if (require.main === module) {
  migrate();
  console.log('Migrations complete.');
}

module.exports = migrate;

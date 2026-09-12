const db = require('./connection');
const migrate = require('./migrate');

function seed() {
  migrate();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM farms').get();
  if (n === 0) {
    const info = db
      .prepare('INSERT INTO farms (name, currency, milk_unit, week_start) VALUES (?, ?, ?, ?)')
      .run('My Dairy Farm', 'PKR', 'L', 'monday');
    db.prepare('INSERT INTO users (farm_id, name, email) VALUES (?, ?, ?)').run(
      info.lastInsertRowid,
      'Farm Owner',
      null
    );
    console.log('Seeded default farm.');
  }
}

if (require.main === module) {
  seed();
  console.log('Seed complete.');
}

module.exports = seed;

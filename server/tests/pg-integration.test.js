// pg-mem is an in-memory PostgreSQL emulator used for automated confidence only.
// It does not implement full transaction rollback semantics, so the driver's
// BEGIN/COMMIT/ROLLBACK wiring is verified with a mock pool in pg-driver.test.js,
// and real rollback semantics are covered by the SQLite suite. Verify against a
// real PostgreSQL database before relying on it in production (see docs/DEPLOYMENT.md).
const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.tmpdir(), `dairy-pg-integration-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { newDb, DataType } = require('pg-mem');

require('../db/seed')();

const db = require('../db');
const connection = require('../db/connection');
const { createPgDriver } = require('../db/pgDriver');

const animalService = require('../services/animalService');
const milkService = require('../services/milkService');
const financeService = require('../services/financeService');
const healthService = require('../services/healthService');
const employeeService = require('../services/employeeService');
const paymentService = require('../services/paymentService');
const inventoryService = require('../services/inventoryService');
const movementService = require('../services/inventoryMovementService');
const breedingService = require('../services/breedingService');
const { todayLocal } = require('../utils/date');

const mem = newDb();
mem.public.registerFunction({
  name: 'substr',
  args: [DataType.text, DataType.integer, DataType.integer],
  returns: DataType.text,
  implementation: (value, from, length) => String(value).substr(from - 1, length)
});

const { Pool } = mem.adapters.createPg();
const pool = new Pool();
const driver = createPgDriver({ pool });

const PG_DIR = path.join(__dirname, '..', 'db', 'pg', 'migrations');
const PG_FILES = fs
  .readdirSync(PG_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

before(async () => {
  // Mirrors pgInit.migrate exactly: schema_migrations tracking table, then each
  // migration file's DDL + tracking insert inside one driver transaction. The
  // tracking insert must go through tx.all — tx.run appends RETURNING id and
  // schema_migrations has no id column (regression guard for a real-PG failure).
  await driver.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT '')`
  );
  for (const file of PG_FILES) {
    const sql = fs
      .readFileSync(path.join(PG_DIR, file), 'utf8')
      .replace(/to_char\(now\(\) AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'\)/g, "''");
    await driver.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.all('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    });
  }

  db.setDriver(driver);
});

const today = todayLocal();

async function seedFarm() {
  await driver.run('INSERT INTO farms (name, currency, milk_unit, week_start) VALUES (?, ?, ?, ?)', [
    'PG Farm',
    'PKR',
    'L',
    'monday'
  ]);
}

test('migrations applied through the driver record every file in schema_migrations', async () => {
  const rows = await driver.all('SELECT name FROM schema_migrations ORDER BY name');
  assert.deepEqual(
    rows.map((row) => row.name),
    PG_FILES
  );
});

test('services run end to end against a PostgreSQL driver', async () => {
  await seedFarm();

  const animal = await animalService.create({ tag_number: 'PG-1', type: 'cow', gender: 'female' });
  assert.equal(animal.tag_number, 'PG-1');
  assert.equal(typeof animal.id, 'number');

  const milk = await milkService.create({
    animal_id: animal.id,
    date: today,
    session: 'morning',
    quantity: 12.5,
    unit: 'L'
  });
  assert.equal(milk.quantity, 12.5);

  const health = await healthService.create({
    animal_id: animal.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    cost: 500
  });
  assert.ok(health.transaction_id, 'health record must link a finance expense');

  let totals = await financeService.totals();
  assert.equal(totals.expenses, 500);

  const updatedHealth = await healthService.update(health.id, {
    animal_id: animal.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    cost: 300
  });
  assert.equal(updatedHealth.cost, 300);
  totals = await financeService.totals();
  assert.equal(totals.expenses, 300, 'editing health cost must update the linked expense, not duplicate it');

  await healthService.remove(health.id);
  totals = await financeService.totals();
  assert.equal(totals.expenses, 0, 'deleting the health record must remove the linked expense');

  const employee = await employeeService.create({ name: 'PG Worker', pay_type: 'monthly', salary: 1000 });
  const payment = await paymentService.create({
    employee_id: employee.id,
    date: today,
    type: 'salary',
    amount: 1000
  });
  assert.ok(payment.transaction_id);

  const item = await inventoryService.create({ name: 'PG Silage', category: 'silage', unit: 'kg', minimum_stock: 100 });
  await movementService.create({ item_id: item.id, date: today, type: 'opening', quantity: 100, unit: 'kg' });
  const purchase = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 50,
    unit: 'kg',
    unit_cost: 10,
    total_cost: 500
  });
  assert.ok(purchase.transaction_id, 'purchase must link a feed expense');

  await movementService.create({ item_id: item.id, date: today, type: 'consumption', quantity: 30, unit: 'kg' });

  const itemAfter = await inventoryService.get(item.id);
  assert.equal(itemAfter.current_stock, 120, 'stock is derived from the movement ledger');

  const summary = await inventoryService.summary();
  assert.equal(summary.active_count, 1);
  assert.equal(summary.low_stock_count, 0);
  assert.equal(summary.out_of_stock_count, 0);

  totals = await financeService.totals();
  assert.equal(totals.expenses, 1500, 'labor 1000 + feed 500');
  assert.equal(totals.income, 0);
  assert.equal(totals.net, -1500);
  assert.equal(totals.count, 2);

  const breeding = await breedingService.create({ animal_id: animal.id, heat_date: today });
  assert.equal(breeding.pregnancy_result, 'pending');
  const breedingList = await breedingService.list({});
  assert.equal(breedingList.total, 1);
  assert.equal(breedingList.items[0].animal_tag, 'PG-1');
});

test('failed statements inside a transaction surface as errors without corrupting state', async () => {
  const before = await financeService.totals();

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO health_records (farm_id, animal_id, date, type, condition)
         VALUES (?, ?, ?, 'not-a-valid-type', 'x')`,
        [1, 1, today]
      );
    }),
    (err) => err instanceof Error
  );

  const after = await financeService.totals();
  assert.equal(after.expenses, before.expenses);
});

after(async () => {
  await driver.close();
  if (connection.open) connection.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

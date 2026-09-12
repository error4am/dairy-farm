const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.tmpdir(), `dairy-health-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const db = require('../db/connection');
const animalService = require('../services/animalService');
const healthService = require('../services/healthService');
const milkService = require('../services/milkService');
const financeService = require('../services/financeService');
const dashboardService = require('../services/dashboardService');
const { todayLocal, addDays } = require('../utils/date');

const EPS = 1e-9;
function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPS, `${message} (expected ${expected}, got ${actual})`);
}
function assertNetIdentity(totals, message) {
  assert.equal(totals.net, totals.income - totals.expenses, message);
}

const today = todayLocal();

const animalA = animalService.create({ tag_number: 'H-1', type: 'cow', gender: 'female' });
const animalB = animalService.create({ tag_number: 'H-2', type: 'buffalo', gender: 'female' });
const animalC = animalService.create({ tag_number: 'H-3', type: 'cow', gender: 'female' });

let treatmentId = null;

test('health record without cost does not create a transaction', () => {
  const record = healthService.create({
    animal_id: animalA.id,
    date: today,
    type: 'checkup',
    condition: 'Routine checkup',
    vet_name: 'Dr. Khan'
  });

  assert.equal(record.cost, null);
  assert.equal(record.transaction_id, null);

  const totals = financeService.totals();
  assert.equal(totals.expenses, 0);
  assert.equal(totals.count, 0);
});

test('health record with cost creates a linked medicine expense and keeps net identity', () => {
  const record = healthService.create({
    animal_id: animalA.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    medicine: 'Amoxicillin',
    dosage: '10ml',
    withdrawal_until: addDays(today, 5),
    cost: 3500
  });
  treatmentId = record.id;

  assert.ok(record.transaction_id, 'linked transaction id is stored');
  assertClose(record.cost, 3500, 'cost is read from the linked transaction');

  const totals = financeService.totals();
  assertClose(totals.expenses, 3500, 'expense total includes the treatment');
  assert.equal(totals.count, 1);
  assertNetIdentity(totals, 'net identity after auto expense');

  const list = financeService.list({ limit: 5 });
  assert.equal(list.items[0].category, 'medicine');
  assert.match(list.items[0].description, /Mastitis/);
  assert.equal(list.items[0].animal_id, animalA.id);
});

test('withdrawal blocks milk within the period, allows outside it', () => {
  assert.throws(
    () =>
      milkService.create({ animal_id: animalA.id, date: today, session: 'morning', quantity: 5, unit: 'L' }),
    (err) => err.status === 400 && /withdrawal/i.test(err.message),
    'milk on treatment day is blocked'
  );

  assert.throws(
    () =>
      milkService.create({ animal_id: animalA.id, date: addDays(today, 5), session: 'morning', quantity: 5, unit: 'L' }),
    (err) => err.status === 400 && /withdrawal/i.test(err.message),
    'milk on the last withdrawal day is blocked'
  );

  const allowedAfter = milkService.create({
    animal_id: animalA.id,
    date: addDays(today, 6),
    session: 'morning',
    quantity: 5,
    unit: 'L'
  });
  assert.ok(allowedAfter.id, 'milk after withdrawal is allowed');

  const allowedBefore = milkService.create({
    animal_id: animalA.id,
    date: addDays(today, -2),
    session: 'morning',
    quantity: 4,
    unit: 'L'
  });
  assert.ok(allowedBefore.id, 'milk from before the treatment is allowed');

  assert.throws(
    () =>
      milkService.update(allowedAfter.id, {
        animal_id: animalA.id,
        date: today,
        session: 'morning',
        quantity: 5,
        unit: 'L'
      }),
    (err) => err.status === 400 && /withdrawal/i.test(err.message),
    'editing a record into the withdrawal window is blocked'
  );
});

test('updating cost updates the linked expense', () => {
  healthService.update(treatmentId, {
    animal_id: animalA.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    medicine: 'Amoxicillin',
    dosage: '10ml',
    withdrawal_until: addDays(today, 5),
    cost: 4000
  });

  const totals = financeService.totals();
  assertClose(totals.expenses, 4000, 'expense follows the updated cost');
  assert.equal(totals.count, 1, 'no duplicate expense is created');
  assertNetIdentity(totals, 'net identity after cost update');

  const record = healthService.get(treatmentId);
  assertClose(record.cost, 4000, 'record shows the updated cost');
});

test('clearing cost removes the linked expense', () => {
  healthService.update(treatmentId, {
    animal_id: animalA.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    medicine: 'Amoxicillin',
    dosage: '10ml',
    withdrawal_until: addDays(today, 5),
    cost: null
  });

  const record = healthService.get(treatmentId);
  assert.equal(record.transaction_id, null);
  assert.equal(record.cost, null);

  const totals = financeService.totals();
  assert.equal(totals.expenses, 0);
  assert.equal(totals.count, 0);
  assertNetIdentity(totals, 'net identity after clearing cost');
});

test('deleting a health record removes its linked expense', () => {
  const record = healthService.create({
    animal_id: animalB.id,
    date: today,
    type: 'illness',
    condition: 'Fever',
    cost: 500
  });
  assertClose(financeService.totals().expenses, 500, 'expense created');

  healthService.remove(record.id);

  const totals = financeService.totals();
  assert.equal(totals.expenses, 0);
  assert.equal(totals.count, 0);
  assertNetIdentity(totals, 'net identity after deleting health record');
});

test('health summary counts withdrawals, due dates and monthly events', () => {
  const vaccination = healthService.create({
    animal_id: animalB.id,
    date: today,
    type: 'vaccination',
    condition: 'FMD',
    next_due_date: addDays(today, 10)
  });
  assert.ok(vaccination.id);

  healthService.create({
    animal_id: animalC.id,
    date: today,
    type: 'treatment',
    condition: 'Wound',
    withdrawal_until: addDays(today, 3)
  });

  const summary = healthService.summary();

  assert.equal(summary.withdrawal_count, 2, 'animal A and C are under withdrawal');
  assert.deepEqual(
    summary.withdrawals.map((w) => w.tag_number).sort(),
    ['H-1', 'H-3']
  );
  assert.equal(summary.due_soon_count, 1, 'only the FMD booster is due soon');
  assert.equal(summary.due_soon[0].tag_number, 'H-2');
  assert.equal(summary.due_soon[0].next_due_date, addDays(today, 10));
  assert.equal(summary.events_this_month, 4, 'checkup, treatment, illness, vaccination');

  const byType = Object.fromEntries(summary.by_type.map((t) => [t.type, t.count]));
  assert.equal(byType.checkup, 1);
  assert.equal(byType.treatment, 2);
  assert.equal(byType.vaccination, 1);
  assert.equal(byType.illness, undefined, 'deleted illness record is not counted');
});

test('dashboard health strip matches the health summary', () => {
  const dashboard = dashboardService.get();
  const summary = healthService.summary();

  assert.equal(dashboard.metrics.health.withdrawal_count, summary.withdrawal_count);
  assert.equal(dashboard.metrics.health.due_soon_count, summary.due_soon_count);
  assert.equal(dashboard.metrics.health.events_this_month, summary.events_this_month);
});

test('animal list and profile expose withdrawal state', () => {
  const animals = animalService.list({});
  const a = animals.find((x) => x.tag_number === 'H-1');
  const b = animals.find((x) => x.tag_number === 'H-2');
  const c = animals.find((x) => x.tag_number === 'H-3');

  assert.equal(a.withdrawal_until, addDays(today, 5));
  assert.equal(c.withdrawal_until, addDays(today, 3));
  assert.equal(b.withdrawal_until, null);

  const profile = animalService.profile(a.id);
  assert.equal(profile.animal.withdrawal_until, addDays(today, 5));
  assert.ok(profile.recent_health.length >= 1, 'profile includes health history');
});

test('animal deletion is blocked when health records exist', () => {
  assert.throws(
    () => animalService.remove(animalA.id),
    (err) => err.status === 409,
    'animal with health records cannot be deleted'
  );
});

test('withdrawal date cannot be before the record date', () => {
  assert.throws(
    () =>
      healthService.create({
        animal_id: animalB.id,
        date: today,
        type: 'treatment',
        withdrawal_until: addDays(today, -1)
      }),
    (err) => err.status === 400 && Boolean(err.details && err.details.withdrawal_until),
    'invalid withdrawal date is rejected'
  );
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

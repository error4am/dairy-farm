const os = require('os');
const path = require('path');
const fs = require('fs');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-alerts-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const app = require('../index');
const connection = require('../db/connection');
const alertService = require('../services/alertService');
const animalService = require('../services/animalService');
const breedingService = require('../services/breedingService');
const healthService = require('../services/healthService');
const milkService = require('../services/milkService');
const inventoryService = require('../services/inventoryService');
const movementService = require('../services/inventoryMovementService');
const { todayLocal, addDays } = require('../utils/date');

const today = todayLocal();
const EPS = 1e-9;

let server = null;
let base = '';

let pendingAnimal;
let calving7Animal;
let calving3Animal;
let calvingDueAnimal;
let treatmentAnimal;
let vaccinationAnimal;
let withdrawalAnimal;
let inventoryItem;

function alertRow(triggerKey) {
  return connection.prepare('SELECT * FROM alerts WHERE farm_id = 1 AND trigger_key = ?').get(triggerKey);
}

function alertsFor(sourceType, sourceId) {
  return connection
    .prepare('SELECT * FROM alerts WHERE farm_id = 1 AND source_type = ? AND source_id = ? ORDER BY id')
    .all(sourceType, sourceId);
}

function activeAlertsFor(sourceType, sourceId) {
  return alertsFor(sourceType, sourceId).filter((row) => row.status !== 'resolved');
}

function unreadTotal() {
  return connection.prepare("SELECT COUNT(*) AS n FROM alerts WHERE farm_id = 1 AND status = 'unread'").get().n;
}

async function runEngine() {
  return alertService.runAlertEngine();
}

async function req(method, apiPath, body) {
  const res = await fetch(base + apiPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

before(async () => {
  pendingAnimal = await animalService.create({ tag_number: 'ALERT-P1', type: 'cow', gender: 'female' });
  calving7Animal = await animalService.create({ tag_number: 'ALERT-C7', type: 'cow', gender: 'female' });
  calving3Animal = await animalService.create({ tag_number: 'ALERT-C3', type: 'cow', gender: 'female' });
  calvingDueAnimal = await animalService.create({ tag_number: 'ALERT-CD', type: 'cow', gender: 'female' });
  treatmentAnimal = await animalService.create({ tag_number: 'ALERT-T1', type: 'cow', gender: 'female' });
  vaccinationAnimal = await animalService.create({ tag_number: 'ALERT-V1', type: 'cow', gender: 'female' });
  withdrawalAnimal = await animalService.create({ tag_number: 'ALERT-W1', type: 'cow', gender: 'female' });
});

test('start server on an ephemeral port', async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test('migration creates the alerts table with columns, unique trigger keys and a migration record', () => {
  const table = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'alerts'")
    .get();
  assert.ok(table, 'alerts table exists');

  const columns = connection
    .prepare('PRAGMA table_info(alerts)')
    .all()
    .map((row) => row.name);
  assert.deepEqual(columns, [
    'id',
    'farm_id',
    'type',
    'severity',
    'title',
    'message',
    'source_type',
    'source_id',
    'trigger_key',
    'status',
    'created_at',
    'read_at',
    'resolved_at'
  ]);

  const uniqueConstraints = connection
    .prepare('PRAGMA index_list(alerts)')
    .all()
    .filter((row) => row.origin === 'u');
  assert.equal(uniqueConstraints.length, 1, 'exactly one unique constraint (farm_id, trigger_key)');

  const migrations = connection
    .prepare('SELECT name FROM schema_migrations')
    .all()
    .map((row) => row.name);
  assert.ok(migrations.includes('010_alerts.sql'), '010_alerts.sql recorded');
});

test('engine creates a pregnancy check alert, stays idempotent and never touches breeding data', async () => {
  const record = await breedingService.create({
    animal_id: pendingAnimal.id,
    heat_date: addDays(today, -10),
    service_date: addDays(today, -8),
    service_method: 'natural'
  });

  const before = connection.prepare('SELECT * FROM breeding_records ORDER BY id').all();

  const first = await runEngine();
  assert.ok(first.created >= 1, 'engine created alerts');

  const after = connection.prepare('SELECT * FROM breeding_records ORDER BY id').all();
  assert.deepEqual(after, before, 'engine never modifies breeding records');

  const key = `pregnancy_check:breeding:${record.id}:none`;
  const alert = alertRow(key);
  assert.ok(alert, 'pregnancy check alert exists');
  assert.equal(alert.type, 'pregnancy_check');
  assert.equal(alert.severity, 'warning');
  assert.equal(alert.status, 'unread');
  assert.equal(alert.title, 'Pregnancy check due');
  assert.equal(alert.message, 'Cow #ALERT-P1 needs a pregnancy check.');
  assert.equal(alert.source_type, 'breeding');
  assert.equal(alert.source_id, record.id);

  const second = await runEngine();
  assert.equal(second.created, 0, 'no duplicate on re-run');
  assert.equal(second.resolved, 0, 'nothing resolved when conditions are unchanged');
  assert.equal(alertsFor('breeding', record.id).length, 1, 'exactly one alert for the record');
});

test('the database rejects a duplicate trigger key', () => {
  const existing = connection
    .prepare("SELECT * FROM alerts WHERE farm_id = 1 AND type = 'pregnancy_check'")
    .get();
  assert.ok(existing, 'an alert row exists to clone');

  let error = null;
  try {
    connection
      .prepare(
        `INSERT INTO alerts (farm_id, type, severity, title, message, source_type, source_id, trigger_key, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unread', datetime('now'))`
      )
      .run(
        1,
        existing.type,
        existing.severity,
        existing.title,
        existing.message,
        existing.source_type,
        existing.source_id,
        existing.trigger_key
      );
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'duplicate insert failed');
  assert.equal(error.code, 'SQLITE_CONSTRAINT_UNIQUE');
});

test('calving alerts fire at 7 days, 3 days and due today with per-stage keys', async () => {
  const r7 = await breedingService.create({
    animal_id: calving7Animal.id,
    heat_date: addDays(today, -40),
    service_date: addDays(today, -38),
    service_method: 'natural',
    pregnancy_check_date: addDays(today, -25),
    pregnancy_result: 'pregnant',
    expected_calving_date: addDays(today, 7),
    expected_calving_estimated: false
  });
  const r3 = await breedingService.create({
    animal_id: calving3Animal.id,
    heat_date: addDays(today, -40),
    service_date: addDays(today, -38),
    service_method: 'natural',
    pregnancy_check_date: addDays(today, -25),
    pregnancy_result: 'pregnant',
    expected_calving_date: addDays(today, 3),
    expected_calving_estimated: false
  });
  const rDue = await breedingService.create({
    animal_id: calvingDueAnimal.id,
    heat_date: addDays(today, -40),
    service_date: addDays(today, -38),
    service_method: 'natural',
    pregnancy_check_date: addDays(today, -25),
    pregnancy_result: 'pregnant',
    expected_calving_date: today,
    expected_calving_estimated: false
  });

  await runEngine();

  const a7 = alertRow(`calving:breeding:${r7.id}:7d`);
  assert.ok(a7, '7-day alert exists');
  assert.equal(a7.type, 'calving');
  assert.equal(a7.severity, 'warning');
  assert.equal(a7.title, 'Calving approaching');
  assert.equal(a7.message, 'Cow #ALERT-C7 is expected to calve in 7 days.');

  const a3 = alertRow(`calving:breeding:${r3.id}:3d`);
  assert.ok(a3, '3-day alert exists');
  assert.equal(a3.severity, 'warning');
  assert.equal(a3.message, 'Cow #ALERT-C3 is expected to calve in 3 days.');

  const aDue = alertRow(`calving:breeding:${rDue.id}:due`);
  assert.ok(aDue, 'due-today alert exists');
  assert.equal(aDue.severity, 'critical');
  assert.equal(aDue.title, 'Calving due');
  assert.equal(aDue.message, 'Cow #ALERT-CD is expected to calve today.');

  assert.ok(aDue.severity !== a7.severity, 'due stage outranks approaching stages');
});

test('calving alerts resolve once the breeding record is completed as calved', async () => {
  const record = (await breedingService.list({ animal_id: calving7Animal.id })).items[0];

  const updated = await breedingService.update(record.id, {
    animal_id: calving7Animal.id,
    heat_date: record.heat_date,
    service_date: record.service_date,
    service_method: record.service_method,
    pregnancy_check_date: record.pregnancy_check_date,
    pregnancy_result: 'pregnant',
    expected_calving_date: record.expected_calving_date,
    expected_calving_estimated: false,
    actual_calving_date: record.expected_calving_date,
    calving_outcome: 'successful'
  });
  assert.equal(updated.actual_calving_date, record.expected_calving_date);

  const result = await runEngine();
  assert.ok(result.resolved >= 1, 'stale calving alerts resolved');

  const after = alertsFor('breeding', record.id);
  const calvingAlerts = after.filter((row) => row.type === 'calving');
  assert.equal(calvingAlerts.length, 1, 'alert history kept, not deleted');
  assert.equal(calvingAlerts[0].status, 'resolved');
  assert.ok(calvingAlerts[0].resolved_at, 'resolved_at stamped');

  const stillActive = alertsFor('breeding', (await breedingService.list({ animal_id: calving3Animal.id })).items[0].id);
  assert.ok(
    stillActive.some((row) => row.type === 'calving' && row.status === 'unread'),
    'other animals calving alerts stay active'
  );
});

test('treatment follow-up and vaccination alerts reuse the existing health due dates', async () => {
  const treatment = await healthService.create({
    animal_id: treatmentAnimal.id,
    date: addDays(today, -5),
    type: 'treatment',
    condition: 'Foot rot',
    medicine: 'Spray',
    next_due_date: today
  });
  const vaccination = await healthService.create({
    animal_id: vaccinationAnimal.id,
    date: today,
    type: 'vaccination',
    condition: 'Foot-and-mouth',
    next_due_date: addDays(today, 1)
  });

  await runEngine();

  const t = alertRow(`treatment:health:${treatment.id}:${today}`);
  assert.ok(t, 'treatment follow-up alert exists');
  assert.equal(t.type, 'treatment_followup');
  assert.equal(t.severity, 'warning');
  assert.equal(t.title, 'Treatment follow-up due');
  assert.equal(t.message, 'Cow #ALERT-T1 has a health follow-up due today.');
  assert.equal(t.source_type, 'health');
  assert.equal(t.source_id, treatment.id);

  const v = alertRow(`vaccination:health:${vaccination.id}:${addDays(today, 1)}`);
  assert.ok(v, 'vaccination alert exists');
  assert.equal(v.type, 'vaccination');
  assert.equal(v.severity, 'warning');
  assert.equal(v.title, 'Vaccination due');
  assert.equal(v.message, 'Cow #ALERT-V1 vaccination is due tomorrow.');
});

test('health alerts resolve when the follow-up date is cleared', async () => {
  const record = (await healthService.list({ animal_id: treatmentAnimal.id })).items[0];

  await healthService.update(record.id, {
    animal_id: treatmentAnimal.id,
    date: record.date,
    type: record.type,
    condition: record.condition,
    medicine: record.medicine,
    next_due_date: null
  });

  await runEngine();

  const rows = alertsFor('health', record.id).filter((row) => row.type === 'treatment_followup');
  assert.equal(rows.length, 1, 'alert history kept');
  assert.equal(rows[0].status, 'resolved', 'cleared due date resolves the alert');
});

test('milk withdrawal ending alert appears, milk stays blocked and the alert resolves after the period', async () => {
  const record = await healthService.create({
    animal_id: withdrawalAnimal.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    medicine: 'Long-acting antibiotic',
    withdrawal_until: today
  });

  await runEngine();

  const alert = alertRow(`withdrawal:health:${record.id}:${today}`);
  assert.ok(alert, 'withdrawal ending alert exists');
  assert.equal(alert.type, 'milk_withdrawal');
  assert.equal(alert.severity, 'info');
  assert.equal(alert.title, 'Milk withdrawal ending');
  assert.equal(alert.message, 'Cow #ALERT-W1 milk withdrawal ends today.');

  await assert.rejects(
    () =>
      milkService.create({
        animal_id: withdrawalAnimal.id,
        date: today,
        session: 'morning',
        quantity: 5,
        unit: 'L'
      }),
    /withdrawal/i,
    'milk remains blocked during the withdrawal period'
  );

  await healthService.update(record.id, {
    animal_id: withdrawalAnimal.id,
    date: addDays(today, -5),
    type: record.type,
    condition: record.condition,
    medicine: record.medicine,
    withdrawal_until: addDays(today, -1)
  });

  await runEngine();
  const after = alertRow(`withdrawal:health:${record.id}:${today}`);
  assert.equal(after.status, 'resolved', 'ended withdrawal resolves its alert');
  assert.ok(after.resolved_at, 'resolved_at stamped');
});

test('inventory low/out alerts never overlap and a later low stock is a new event', async () => {
  inventoryItem = await inventoryService.create({
    name: 'Alert Wheat Bran',
    category: 'concentrate',
    unit: 'kg',
    minimum_stock: 50
  });

  const opening = await movementService.create({
    item_id: inventoryItem.id,
    date: today,
    type: 'opening',
    quantity: 45,
    unit: 'kg'
  });
  await runEngine();

  const lowKey = `low_stock:inventory_item:${inventoryItem.id}:${opening.id}`;
  const low = alertRow(lowKey);
  assert.ok(low, 'low stock alert exists with the episode movement key');
  assert.equal(low.type, 'low_stock');
  assert.equal(low.severity, 'warning');
  assert.equal(low.title, 'Low stock');
  assert.equal(low.message, 'Alert Wheat Bran has 45 kg remaining.');
  assert.equal(low.source_type, 'inventory_item');

  const consume = await movementService.create({
    item_id: inventoryItem.id,
    date: today,
    type: 'consumption',
    quantity: 45,
    unit: 'kg'
  });
  await runEngine();

  const outKey = `out_stock:inventory_item:${inventoryItem.id}:${consume.id}`;
  const out = alertRow(outKey);
  assert.ok(out, 'out of stock alert exists');
  assert.equal(out.severity, 'critical');
  assert.equal(out.title, 'Out of stock');
  assert.equal(out.message, 'Alert Wheat Bran is out of stock.');
  const severityRank = { info: 1, warning: 2, critical: 3 };
  assert.ok(
    severityRank[out.severity] > severityRank[low.severity],
    'out of stock outranks low stock'
  );

  const itemAlerts = alertsFor('inventory_item', inventoryItem.id);
  const activeAfterOut = itemAlerts.filter((row) => row.status !== 'resolved');
  assert.equal(activeAfterOut.length, 1, 'never low and out at the same time');
  assert.equal(activeAfterOut[0].type, 'out_of_stock');
  assert.equal(
    itemAlerts.find((row) => row.type === 'low_stock').status,
    'resolved',
    'low stock alert resolved when stock hit zero'
  );

  await movementService.create({
    item_id: inventoryItem.id,
    date: today,
    type: 'purchase',
    quantity: 100,
    unit: 'kg'
  });
  await runEngine();

  const activeAfterRestock = alertsFor('inventory_item', inventoryItem.id).filter(
    (row) => row.status !== 'resolved'
  );
  assert.equal(activeAfterRestock.length, 0, 'replenishment resolves the active inventory alert');

  const secondConsume = await movementService.create({
    item_id: inventoryItem.id,
    date: today,
    type: 'consumption',
    quantity: 60,
    unit: 'kg'
  });
  await runEngine();

  const lowRows = alertsFor('inventory_item', inventoryItem.id).filter((row) => row.type === 'low_stock');
  assert.equal(lowRows.length, 2, 'a later low stock condition creates a new event');
  const newLow = lowRows.find((row) => row.status !== 'resolved');
  assert.ok(newLow, 'new low stock alert is active');
  assert.notEqual(newLow.trigger_key, low.trigger_key, 'new event identity differs from the first');
  assert.equal(
    newLow.trigger_key,
    `low_stock:inventory_item:${inventoryItem.id}:${secondConsume.id}`,
    'new key anchored to the new below-threshold movement'
  );
});

test('alerts resolve when their source record is deleted', async () => {
  const record = (await breedingService.list({ animal_id: calvingDueAnimal.id })).items[0];
  assert.ok(alertsFor('breeding', record.id).some((row) => row.status !== 'resolved'));

  await breedingService.remove(record.id);
  await runEngine();

  const rows = alertsFor('breeding', record.id);
  assert.ok(rows.length >= 1, 'alert history kept after source deletion');
  assert.equal(rows.every((row) => row.status === 'resolved'), true, 'deleted source resolves its alerts');
});

test('unread count, mark read and resolve work and a manual resolve is not recreated', async () => {
  const vaccination = (await healthService.list({ animal_id: vaccinationAnimal.id, type: 'vaccination' }))
    .items[0];
  const vAlert = alertsFor('health', vaccination.id).find((row) => row.type === 'vaccination');
  assert.ok(vAlert && vAlert.status === 'unread');

  const beforeCount = await alertService.unreadCount();
  assert.equal(beforeCount, unreadTotal(), 'unread count matches the database');

  const read = await alertService.markRead(vAlert.id);
  assert.equal(read.status, 'read');
  assert.ok(read.read_at, 'read_at stamped');
  assert.equal(await alertService.unreadCount(), beforeCount - 1, 'unread count drops after reading');

  const reread = await alertService.markRead(vAlert.id);
  assert.equal(reread.status, 'read', 'marking read again is a no-op');

  const resolved = await alertService.resolve(vAlert.id);
  assert.equal(resolved.status, 'resolved');
  assert.ok(resolved.resolved_at, 'resolved_at stamped');

  const rerun = await runEngine();
  assert.equal(rerun.created, 0, 'manual resolve of an ongoing condition is not recreated');
  assert.equal(
    alertsFor('health', vaccination.id).filter((row) => row.type === 'vaccination').length,
    1,
    'still exactly one vaccination alert'
  );
});

test('HTTP: list, filters, unread count, run trigger, mark read, resolve and 404s', async () => {
  const listed = await req('GET', '/alerts');
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.data.items), 'list shape has items');
  assert.equal(typeof listed.data.total, 'number', 'list shape has total');
  assert.equal(typeof listed.data.limit, 'number', 'list shape has limit');
  assert.ok(listed.data.items.length > 0, 'alerts are returned');
  const sample = listed.data.items[0];
  for (const field of ['id', 'type', 'severity', 'title', 'message', 'status', 'source_type', 'source_id', 'trigger_key', 'created_at']) {
    assert.ok(field in sample, `alert payload includes ${field}`);
  }

  const unreadOnly = await req('GET', '/alerts?status=unread');
  assert.equal(unreadOnly.status, 200);
  assert.ok(unreadOnly.data.items.every((row) => row.status === 'unread'), 'status filter works');

  const badFilter = await req('GET', '/alerts?status=bogus');
  assert.equal(badFilter.status, 400, 'unknown status filter rejected');

  const count = await req('GET', '/alerts/unread-count');
  assert.equal(count.status, 200);
  assert.equal(count.data.count, unreadTotal(), 'HTTP unread count matches the database');

  const run1 = await req('POST', '/alerts/run');
  assert.equal(run1.status, 200);
  assert.equal(typeof run1.data.created, 'number');
  assert.equal(typeof run1.data.resolved, 'number');
  assert.equal(run1.data.unread, unreadTotal());
  const run2 = await req('POST', '/alerts/run');
  assert.equal(run2.status, 200);
  assert.equal(run2.data.created, 0, 'second explicit run creates nothing');
  assert.equal(run2.data.resolved, 0, 'second explicit run resolves nothing');

  const target = count.data.count > 0 ? unreadTotal() : 0;
  assert.ok(target > 0, 'there is at least one unread alert to exercise');
  const unreadRow = connection
    .prepare("SELECT * FROM alerts WHERE farm_id = 1 AND status = 'unread' ORDER BY id LIMIT 1")
    .get();

  const readRes = await req('POST', `/alerts/${unreadRow.id}/read`);
  assert.equal(readRes.status, 200);
  assert.equal(readRes.data.status, 'read');
  assert.ok(readRes.data.read_at);

  const countAfterRead = await req('GET', '/alerts/unread-count');
  assert.equal(countAfterRead.data.count, unreadTotal(), 'count updates after read');
  assert.equal(countAfterRead.data.count, target - 1, 'unread count dropped by exactly one');

  const resolveRes = await req('POST', `/alerts/${unreadRow.id}/resolve`);
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.data.status, 'resolved');
  assert.ok(resolveRes.data.resolved_at);

  const missing = await req('POST', '/alerts/999999/read');
  assert.equal(missing.status, 404, 'unknown alert reports not found');
  const missingResolve = await req('POST', '/alerts/999999/resolve');
  assert.equal(missingResolve.status, 404, 'unknown alert reports not found on resolve');
});

test('alerts are farm scoped: foreign farm rows are invisible and unwritable', async () => {
  connection.prepare("INSERT INTO farms (id, name) VALUES (999, 'Foreign Farm')").run();
  connection
    .prepare(
      `INSERT INTO alerts (farm_id, type, severity, title, message, source_type, source_id, trigger_key, status, created_at)
       VALUES (999, 'low_stock', 'warning', 'Foreign', 'Foreign alert', 'inventory_item', 999, 'out_stock:inventory_item:999:0', 'unread', datetime('now'))`
    )
    .run();
  const foreign = connection
    .prepare("SELECT * FROM alerts WHERE farm_id = 999 AND trigger_key = 'out_stock:inventory_item:999:0'")
    .get();
  assert.ok(foreign, 'foreign alert row exists');

  const before = unreadTotal();

  const listed = await req('GET', '/alerts?limit=200');
  assert.equal(listed.status, 200);
  assert.equal(
    listed.data.items.some((row) => row.id === foreign.id),
    false,
    'foreign alerts are never listed'
  );

  const count = await req('GET', '/alerts/unread-count');
  assert.equal(count.data.count, before, 'foreign alerts never counted');

  const read = await req('POST', `/alerts/${foreign.id}/read`);
  assert.equal(read.status, 404, 'other-farm alerts cannot be written');

  const resolve = await req('POST', `/alerts/${foreign.id}/resolve`);
  assert.equal(resolve.status, 404, 'other-farm alerts cannot be resolved');

  connection.prepare('DELETE FROM alerts WHERE farm_id = 999').run();
  connection.prepare('DELETE FROM farms WHERE id = 999').run();
});

after(async () => {
  if (server) {
    server.close();
    await once(server, 'close').catch(() => {});
  }
  if (connection.open) connection.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

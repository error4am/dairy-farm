const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.tmpdir(), `dairy-breeding-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const db = require('../db/connection');
const animalService = require('../services/animalService');
const breedingService = require('../services/breedingService');
const dashboardService = require('../services/dashboardService');
const { todayLocal, addDays } = require('../utils/date');

const today = todayLocal();

const animalA = animalService.create({ tag_number: 'B-1', type: 'cow', gender: 'female' });
const animalB = animalService.create({ tag_number: 'B-2', type: 'buffalo', gender: 'female' });
const animalC = animalService.create({ tag_number: 'B-3', type: 'cow', gender: 'female' });

let heatOnlyId = null;
let pregnantAttemptId = null;

test('creates a heat-only record without pregnancy information', () => {
  const record = breedingService.create({ animal_id: animalA.id, heat_date: addDays(today, -30) });
  heatOnlyId = record.id;

  assert.equal(record.heat_date, addDays(today, -30));
  assert.equal(record.service_date, null);
  assert.equal(record.pregnancy_result, 'pending');
  assert.equal(record.calving_outcome, 'pending');
  assert.equal(record.expected_calving_date, null);
  assert.equal(breedingService.currentForAnimal(animalA.id), null, 'pending record is not a pregnancy');
});

test('multiple breeding attempts stay in history and the latest completed result decides pregnancy', () => {
  const failed = breedingService.update(heatOnlyId, {
    animal_id: animalA.id,
    heat_date: addDays(today, -30),
    service_date: addDays(today, -28),
    service_method: 'artificial_insemination',
    sire_info: 'Bull A',
    pregnancy_check_date: addDays(today, -5),
    pregnancy_result: 'not_pregnant'
  });

  const pregnant = breedingService.create({
    animal_id: animalA.id,
    heat_date: addDays(today, -8),
    service_date: addDays(today, -6),
    service_method: 'natural',
    sire_info: 'Bull B',
    pregnancy_check_date: addDays(today, -1),
    pregnancy_result: 'pregnant',
    expected_calving_date: addDays(today, 277),
    expected_calving_estimated: true
  });
  pregnantAttemptId = pregnant.id;

  const list = breedingService.list({ animal_id: animalA.id });
  assert.equal(list.total, 2, 'both attempts remain in history');
  assert.ok(list.items.some((r) => r.id === failed.id && r.pregnancy_result === 'not_pregnant'));
  assert.ok(list.items.some((r) => r.id === pregnantAttemptId && r.pregnancy_result === 'pregnant'));

  const current = breedingService.currentForAnimal(animalA.id);
  assert.ok(current, 'animal is currently pregnant');
  assert.equal(current.id, pregnantAttemptId, 'the latest completed check decides status');
  assert.equal(current.expected_calving_date, addDays(today, 277));
  assert.equal(current.expected_calving_estimated, 1, 'estimated flag is stored');
});

test('a newer pending attempt does not erase a confirmed pregnancy', () => {
  breedingService.create({
    animal_id: animalB.id,
    heat_date: addDays(today, -10),
    service_date: addDays(today, -8),
    service_method: 'artificial_insemination',
    pregnancy_result: 'pending'
  });

  const summary = breedingService.summary();
  assert.equal(summary.pending_checks_count, 1, 'pending check is listed');
  assert.equal(summary.pending_checks[0].animal_tag, 'B-2');

  const list = breedingService.list({ pending_checks: '1' });
  assert.equal(list.total, 1);
});

test('not-pregnant result is not a current pregnancy and remains in history', () => {
  const record = breedingService.create({
    animal_id: animalC.id,
    heat_date: addDays(today, -25),
    service_date: addDays(today, -23),
    service_method: 'natural',
    pregnancy_check_date: addDays(today, -3),
    pregnancy_result: 'not_pregnant'
  });

  assert.equal(breedingService.currentForAnimal(animalC.id), null);
  const summary = breedingService.summary();
  assert.ok(!summary.currently_pregnant.some((r) => r.animal_id === animalC.id));
  assert.equal(breedingService.get(record.id).pregnancy_result, 'not_pregnant');
});

test('confirmed pregnancy appears with its expected calving date', () => {
  const summary = breedingService.summary();
  const entry = summary.currently_pregnant.find((r) => r.animal_id === animalA.id);

  assert.ok(entry, 'animal A is in the pregnant list');
  assert.equal(entry.expected_calving_date, addDays(today, 277));
  assert.equal(summary.currently_pregnant_count, 1);
});

test('upcoming calving includes overdue and near dates, excludes far dates', () => {
  breedingService.create({
    animal_id: animalB.id,
    heat_date: addDays(today, -50),
    service_date: addDays(today, -48),
    service_method: 'natural',
    pregnancy_check_date: addDays(today, -20),
    pregnancy_result: 'pregnant',
    expected_calving_date: addDays(today, -3),
    expected_calving_estimated: false
  });

  const summary = breedingService.summary();
  assert.equal(summary.calving_soon_count, 1, 'overdue pregnancy is flagged');
  assert.equal(summary.calving_soon[0].animal_tag, 'B-2');
  assert.equal(summary.currently_pregnant_count, 2, 'both A and B are pregnant');

  const due = breedingService.list({ due: 'soon' });
  assert.equal(due.total, 1);
  assert.equal(due.items[0].animal_tag, 'B-2');
});

test('recording actual calving completes the cycle and clears current pregnancy', () => {
  const bRecords = breedingService.list({ animal_id: animalB.id, pregnancy_result: 'pregnant' });
  const calvingRecord = bRecords.items[0];

  const updated = breedingService.update(calvingRecord.id, {
    animal_id: animalB.id,
    heat_date: addDays(today, -50),
    service_date: addDays(today, -48),
    service_method: 'natural',
    pregnancy_check_date: addDays(today, -20),
    pregnancy_result: 'pregnant',
    expected_calving_date: addDays(today, -3),
    actual_calving_date: today,
    calving_outcome: 'successful',
    offspring_count: 2
  });

  assert.equal(updated.actual_calving_date, today);
  assert.equal(updated.calving_outcome, 'successful');
  assert.equal(updated.offspring_count, 2);

  assert.equal(breedingService.currentForAnimal(animalB.id), null, 'calved animal is no longer pregnant');

  const summary = breedingService.summary();
  assert.equal(summary.currently_pregnant_count, 1);
  assert.equal(summary.calving_soon_count, 0);
  assert.equal(breedingService.list({ due: 'soon' }).total, 0);
});

test('history stays intact after all lifecycle changes', () => {
  const all = breedingService.list({});
  assert.equal(all.total, 5, 'A:2, B:2, C:1 records all preserved');

  const bHistory = breedingService.list({ animal_id: animalB.id });
  assert.equal(bHistory.total, 2, 'calved attempt and pending attempt both kept');
  assert.ok(bHistory.items.some((r) => r.actual_calving_date === today));
  assert.ok(bHistory.items.some((r) => r.pregnancy_result === 'pending'));
});

test('filters by result and service method work', () => {
  assert.equal(breedingService.list({ pregnancy_result: 'pregnant' }).total, 2, 'A pregnant + B calved');
  assert.equal(breedingService.list({ service_method: 'artificial_insemination' }).total, 2);
  assert.equal(breedingService.list({ service_method: 'natural' }).total, 3);
  assert.equal(breedingService.list({ animal_id: animalC.id }).total, 1);
});

test('invalid or inconsistent dates are rejected', () => {
  const base = { animal_id: animalC.id };

  assert.throws(
    () => breedingService.create({ ...base }),
    (err) => err.status === 400 && Boolean(err.details.heat_date),
    'record needs a heat or service date'
  );
  assert.throws(
    () => breedingService.create({ ...base, heat_date: today, service_date: addDays(today, -1), service_method: 'natural' }),
    (err) => err.status === 400 && Boolean(err.details.heat_date),
    'heat cannot be after service'
  );
  assert.throws(
    () => breedingService.create({ ...base, service_date: today }),
    (err) => err.status === 400 && Boolean(err.details.service_method),
    'service requires a method'
  );
  assert.throws(
    () =>
      breedingService.create({
        ...base,
        service_date: addDays(today, -5),
        service_method: 'natural',
        pregnancy_check_date: addDays(today, -10)
      }),
    (err) => err.status === 400 && Boolean(err.details.pregnancy_check_date),
    'check cannot be before service'
  );
  assert.throws(
    () =>
      breedingService.create({
        ...base,
        service_date: today,
        service_method: 'natural',
        expected_calving_date: today
      }),
    (err) => err.status === 400 && Boolean(err.details.expected_calving_date),
    'expected calving must be after service'
  );
  assert.throws(
    () =>
      breedingService.create({
        ...base,
        service_date: addDays(today, -10),
        service_method: 'natural',
        actual_calving_date: today,
        calving_outcome: 'successful'
      }),
    (err) => err.status === 400 && Boolean(err.details.actual_calving_date),
    'actual calving requires a confirmed pregnancy'
  );
  assert.throws(
    () =>
      breedingService.create({
        ...base,
        service_date: addDays(today, -10),
        service_method: 'natural',
        calving_outcome: 'successful'
      }),
    (err) => err.status === 400 && Boolean(err.details.calving_outcome),
    'outcome requires an actual calving date'
  );
  assert.throws(
    () =>
      breedingService.create({
        ...base,
        service_date: addDays(today, -10),
        service_method: 'natural',
        offspring_count: 1
      }),
    (err) => err.status === 400 && Boolean(err.details.offspring_count),
    'offspring requires an actual calving date'
  );
  assert.throws(
    () =>
      breedingService.create({
        ...base,
        service_date: addDays(today, -10),
        service_method: 'natural',
        pregnancy_result: 'pregnant',
        expected_calving_date: addDays(today, 270)
      }),
    (err) => err.status === 400 && Boolean(err.details.pregnancy_check_date),
    'pregnant requires a check date'
  );
  assert.throws(
    () =>
      breedingService.create({
        ...base,
        service_date: addDays(today, -10),
        service_method: 'natural',
        pregnancy_result: 'pregnant',
        pregnancy_check_date: addDays(today, -1)
      }),
    (err) => err.status === 400 && Boolean(err.details.expected_calving_date),
    'pregnant requires an expected calving date'
  );
  assert.throws(
    () =>
      breedingService.create({
        ...base,
        service_date: addDays(today, -10),
        service_method: 'natural',
        pregnancy_check_date: addDays(today, -1),
        pregnancy_result: 'pregnant',
        expected_calving_date: addDays(today, 270),
        actual_calving_date: today,
        calving_outcome: 'successful',
        offspring_count: -1
      }),
    (err) => err.status === 400 && Boolean(err.details.offspring_count),
    'negative offspring rejected'
  );
});

test('clearing pregnancy result clears the expected calving date', () => {
  const record = breedingService.create({
    animal_id: animalC.id,
    service_date: addDays(today, -40),
    service_method: 'natural',
    pregnancy_check_date: addDays(today, -10),
    pregnancy_result: 'pregnant',
    expected_calving_date: addDays(today, 243),
    expected_calving_estimated: true
  });
  assert.equal(record.expected_calving_date, addDays(today, 243));

  const reverted = breedingService.update(record.id, {
    animal_id: animalC.id,
    service_date: addDays(today, -40),
    service_method: 'natural',
    pregnancy_check_date: addDays(today, -10),
    pregnancy_result: 'not_pregnant',
    expected_calving_date: addDays(today, 243)
  });
  assert.equal(reverted.expected_calving_date, null, 'stale expected date is removed');
  assert.equal(reverted.expected_calving_estimated, 0);
  assert.equal(breedingService.currentForAnimal(animalC.id), null);
});

test('dashboard breeding cards match the breeding summary', () => {
  const dashboard = dashboardService.get();
  const summary = breedingService.summary();

  assert.equal(dashboard.metrics.breeding.currently_pregnant, summary.currently_pregnant_count);
  assert.equal(dashboard.metrics.breeding.calving_soon, summary.calving_soon_count);
  assert.equal(dashboard.metrics.breeding.pending_checks, summary.pending_checks_count);
});

test('animal deletion is blocked when breeding records exist', () => {
  assert.throws(
    () => animalService.remove(animalA.id),
    (err) => err.status === 409,
    'animal with breeding records cannot be deleted'
  );
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

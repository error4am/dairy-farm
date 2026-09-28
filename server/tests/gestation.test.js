const os = require('os');
const path = require('path');
const fs = require('fs');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-gestation-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const app = require('../index');
const db = require('../db/connection');
const settingsService = require('../services/settingsService');
const animalService = require('../services/animalService');
const breedingService = require('../services/breedingService');
const { todayLocal, addDays } = require('../utils/date');

const today = todayLocal();
const SPEC_SERVICE = '2026-09-28';
const SPEC_CHECK = '2026-10-05';
const COW_SPEC_EXPECTED = '2027-07-08';
const BUFFALO_SPEC_EXPECTED = '2027-08-04';

let server = null;
let base = '';

async function req(method, urlPath, body) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('start server on an ephemeral port', async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test('default gestation settings are cow 283 and buffalo 310', async () => {
  const breeding = await settingsService.getBreeding();
  assert.equal(breeding.cow_gestation_days, 283, 'cow gestation defaults to 283 days');
  assert.equal(breeding.buffalo_gestation_days, 310, 'buffalo gestation defaults to 310 days');

  const farm = await settingsService.get();
  assert.equal(farm.cow_gestation_days, 283);
  assert.equal(farm.buffalo_gestation_days, 310);
  assert.equal(farm.gestation_days, 283, 'legacy gestation column keeps its default');
});

test('gestation settings are served and updated over HTTP', async () => {
  const read = await req('GET', '/settings/breeding');
  assert.equal(read.status, 200);
  assert.equal(read.data.cow_gestation_days, 283);
  assert.equal(read.data.buffalo_gestation_days, 310);

  const rejected = await req('PUT', '/settings/breeding', { cow_gestation_days: 0, buffalo_gestation_days: 310 });
  assert.equal(rejected.status, 400);
  assert.ok(Boolean(rejected.data.details.cow_gestation_days), 'zero cow gestation is a field error');

  const saved = await req('PUT', '/settings/breeding', { cow_gestation_days: 283, buffalo_gestation_days: 310 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data, { cow_gestation_days: 283, buffalo_gestation_days: 310 });
});

test('gestation updates reject zero, negative, decimal, non-numeric and unreasonably large values', async () => {
  const cases = [
    { cow_gestation_days: 0, buffalo_gestation_days: 310, field: 'cow_gestation_days' },
    { cow_gestation_days: -10, buffalo_gestation_days: 310, field: 'cow_gestation_days' },
    { cow_gestation_days: 283.5, buffalo_gestation_days: 310, field: 'cow_gestation_days' },
    { cow_gestation_days: 'abc', buffalo_gestation_days: 310, field: 'cow_gestation_days' },
    { cow_gestation_days: 50000, buffalo_gestation_days: 310, field: 'cow_gestation_days' },
    { cow_gestation_days: 1, buffalo_gestation_days: 310, field: 'cow_gestation_days' },
    { cow_gestation_days: 283, buffalo_gestation_days: 0, field: 'buffalo_gestation_days' },
    { cow_gestation_days: 283, buffalo_gestation_days: -1, field: 'buffalo_gestation_days' },
    { cow_gestation_days: 283, buffalo_gestation_days: 310.5, field: 'buffalo_gestation_days' },
    { cow_gestation_days: 283, buffalo_gestation_days: 'x', field: 'buffalo_gestation_days' },
    { cow_gestation_days: 283, buffalo_gestation_days: 50000, field: 'buffalo_gestation_days' }
  ];

  for (const item of cases) {
    await assert.rejects(
      () => settingsService.updateBreeding(item),
      (err) => err.status === 400 && Boolean(err.details[item.field]),
      `${item.field}=${item[item.field]} is rejected`
    );
  }

  const breeding = await settingsService.getBreeding();
  assert.equal(breeding.cow_gestation_days, 283, 'rejected updates change nothing');
  assert.equal(breeding.buffalo_gestation_days, 310);
});

test('gestation updates require both values', async () => {
  await assert.rejects(
    () => settingsService.updateBreeding({ buffalo_gestation_days: 310 }),
    (err) => err.status === 400 && Boolean(err.details.cow_gestation_days),
    'missing cow gestation is a field error'
  );
  await assert.rejects(
    () => settingsService.updateBreeding({ cow_gestation_days: 283 }),
    (err) => err.status === 400 && Boolean(err.details.buffalo_gestation_days),
    'missing buffalo gestation is a field error'
  );
});

let cow;
let buffalo;
let cowPregnancy;
let buffaloPregnancy;

test('new cow breeding uses the configured cow gestation duration', async () => {
  cow = await animalService.create({ tag_number: 'G-COW', type: 'cow', gender: 'female' });
  buffalo = await animalService.create({ tag_number: 'G-BUF', type: 'buffalo', gender: 'female' });

  const record = await breedingService.create({
    animal_id: cow.id,
    service_date: SPEC_SERVICE,
    service_method: 'artificial_insemination',
    pregnancy_check_date: SPEC_CHECK,
    pregnancy_result: 'pregnant',
    expected_calving_date: '2027-01-01',
    expected_calving_estimated: 1
  });
  cowPregnancy = record;

  assert.equal(record.expected_calving_date, COW_SPEC_EXPECTED, 'service 2026-09-28 + 283 = 2027-07-08');
  assert.equal(record.expected_calving_estimated, 1);

  const dynamic = await breedingService.create({
    animal_id: cow.id,
    heat_date: addDays(today, -6),
    service_date: today,
    service_method: 'natural',
    pregnancy_check_date: today,
    pregnancy_result: 'pregnant',
    expected_calving_date: '2027-01-01',
    expected_calving_estimated: 1
  });
  assert.equal(dynamic.expected_calving_date, addDays(today, 283), 'server overrides the client value');
  await breedingService.remove(dynamic.id);
});

test('new buffalo breeding uses the configured buffalo gestation duration', async () => {
  const record = await breedingService.create({
    animal_id: buffalo.id,
    service_date: SPEC_SERVICE,
    service_method: 'artificial_insemination',
    pregnancy_check_date: SPEC_CHECK,
    pregnancy_result: 'pregnant',
    expected_calving_date: '2027-01-01',
    expected_calving_estimated: 1
  });
  buffaloPregnancy = record;

  assert.equal(record.expected_calving_date, BUFFALO_SPEC_EXPECTED, 'service 2026-09-28 + 310 = 2027-08-04');
  assert.equal(record.expected_calving_estimated, 1);
});

test('changing the settings does not rewrite historical cow breeding records', async () => {
  await settingsService.updateBreeding({ cow_gestation_days: 285, buffalo_gestation_days: 312 });

  const old = await breedingService.get(cowPregnancy.id);
  assert.equal(old.expected_calving_date, COW_SPEC_EXPECTED, 'the stored date is immutable');

  const fresh = await breedingService.create({
    animal_id: cow.id,
    service_date: today,
    service_method: 'natural',
    pregnancy_check_date: today,
    pregnancy_result: 'pregnant',
    expected_calving_estimated: 1
  });
  assert.equal(fresh.expected_calving_date, addDays(today, 285), 'new records use the new cow duration');
  await breedingService.remove(fresh.id);
});

test('changing the settings does not rewrite historical buffalo breeding records', async () => {
  const old = await breedingService.get(buffaloPregnancy.id);
  assert.equal(old.expected_calving_date, BUFFALO_SPEC_EXPECTED, 'the stored date is immutable');

  const fresh = await breedingService.create({
    animal_id: buffalo.id,
    service_date: today,
    service_method: 'natural',
    pregnancy_check_date: today,
    pregnancy_result: 'pregnant',
    expected_calving_estimated: 1
  });
  assert.equal(fresh.expected_calving_date, addDays(today, 312), 'new records use the new buffalo duration');
  await breedingService.remove(fresh.id);
});

test('editing a historical record keeps its stored expected calving date', async () => {
  const edited = await breedingService.update(cowPregnancy.id, {
    animal_id: cow.id,
    service_date: SPEC_SERVICE,
    service_method: 'artificial_insemination',
    pregnancy_check_date: SPEC_CHECK,
    pregnancy_result: 'pregnant',
    expected_calving_date: COW_SPEC_EXPECTED,
    expected_calving_estimated: 1,
    notes: 'Notes edited after the gestation settings changed.'
  });

  assert.equal(edited.expected_calving_date, COW_SPEC_EXPECTED, 'editing notes does not recalculate history');
  assert.equal(edited.notes, 'Notes edited after the gestation settings changed.');

  const settings = await settingsService.getBreeding();
  assert.equal(settings.cow_gestation_days, 285, 'settings still hold the changed value');
});

test('changing the service date recomputes the estimated calving date', async () => {
  const newService = addDays(SPEC_SERVICE, -3);
  const updated = await breedingService.update(cowPregnancy.id, {
    animal_id: cow.id,
    service_date: newService,
    service_method: 'artificial_insemination',
    pregnancy_check_date: SPEC_CHECK,
    pregnancy_result: 'pregnant',
    expected_calving_date: COW_SPEC_EXPECTED,
    expected_calving_estimated: 1
  });

  assert.equal(updated.expected_calving_date, addDays(newService, 285), 'an explicit service edit recalculates');
  assert.equal(updated.expected_calving_estimated, 1);
});

test('a newer pending attempt does not erase a confirmed pregnancy', async () => {
  await breedingService.create({
    animal_id: cow.id,
    service_date: today,
    service_method: 'artificial_insemination',
    pregnancy_result: 'pending'
  });

  const current = await breedingService.currentForAnimal(cow.id);
  assert.ok(current, 'the cow is still pregnant');
  assert.equal(current.id, cowPregnancy.id, 'the confirmed pregnancy stays current');
  assert.equal(current.pregnancy_result, 'pregnant');
  assert.equal(
    current.expected_calving_date,
    addDays(addDays(SPEC_SERVICE, -3), 285),
    'expected calving is preserved through the pending attempt'
  );
});

test('unsupported animal type is rejected for confirmed pregnancies but allowed for pending records', async () => {
  const other = await animalService.create({ tag_number: 'G-OTHER', type: 'other', gender: 'female' });

  const pending = await breedingService.create({
    animal_id: other.id,
    heat_date: addDays(today, -5),
    service_date: addDays(today, -3),
    service_method: 'natural',
    pregnancy_result: 'pending'
  });
  assert.equal(pending.pregnancy_result, 'pending', 'pending records need no gestation duration');

  await assert.rejects(
    () =>
      breedingService.create({
        animal_id: other.id,
        service_date: today,
        service_method: 'natural',
        pregnancy_check_date: today,
        pregnancy_result: 'pregnant',
        expected_calving_date: addDays(today, 280),
        expected_calving_estimated: 0
      }),
    (err) =>
      err.status === 400 &&
      Boolean(err.details.animal_id) &&
      /not configured for animal type "other"/.test(err.details.animal_id),
    'a clear validation error replaces the wrong duration'
  );
});

test('invalid gestation values are rejected over HTTP', async () => {
  const zero = await req('PUT', '/settings/breeding', { cow_gestation_days: 0, buffalo_gestation_days: 312 });
  assert.equal(zero.status, 400);
  assert.ok(Boolean(zero.data.details.cow_gestation_days));

  const decimal = await req('PUT', '/settings/breeding', { cow_gestation_days: 284.5, buffalo_gestation_days: 312 });
  assert.equal(decimal.status, 400);
  assert.ok(Boolean(decimal.data.details.cow_gestation_days));

  const huge = await req('PUT', '/settings/breeding', { cow_gestation_days: 285, buffalo_gestation_days: 50000 });
  assert.equal(huge.status, 400);
  assert.ok(Boolean(huge.data.details.buffalo_gestation_days));

  const read = await req('GET', '/settings/breeding');
  assert.equal(read.status, 200);
  assert.deepEqual(read.data, { cow_gestation_days: 285, buffalo_gestation_days: 312 });
});

after(async () => {
  if (server) {
    server.close();
    await once(server, 'close').catch(() => {});
  }
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});


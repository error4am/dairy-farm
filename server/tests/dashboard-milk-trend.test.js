const os = require('os');
const path = require('path');
const fs = require('fs');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-milk-trend-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const app = require('../index');
const connection = require('../db/connection');
const dashboardService = require('../services/dashboardService');
const animalService = require('../services/animalService');
const milkService = require('../services/milkService');
const { todayLocal, addDays } = require('../utils/date');

const today = todayLocal();

let server = null;
let base = '';
let trendAnimal;
let secondAnimal;

async function req(method, apiPath) {
  const res = await fetch(base + apiPath, { method });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function serviceDay(series, date) {
  const day = series.data.find((d) => d.date === date);
  assert.ok(day, `series contains ${date}`);
  return day;
}

before(async () => {
  trendAnimal = await animalService.create({ tag_number: 'TREND-1', type: 'cow', gender: 'female' });
  secondAnimal = await animalService.create({ tag_number: 'TREND-2', type: 'buffalo', gender: 'female' });
});

test('start server on an ephemeral port', async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test('milkProduction defaults to 30 zero-filled days ending today', async () => {
  const series = await dashboardService.milkProduction();
  assert.equal(series.range, 30, 'default range is 30 days');
  assert.equal(series.unit, 'L', 'the farm milk unit is returned');
  assert.equal(series.data.length, 30, 'one entry per day');
  assert.equal(series.data[0].date, addDays(today, -29), 'window starts 29 days ago');
  assert.equal(series.data[29].date, today, 'window ends today');
  for (let i = 1; i < series.data.length; i += 1) {
    assert.equal(series.data[i].date, addDays(series.data[i - 1].date, 1), 'days are contiguous and ascending');
  }
  for (const day of series.data) {
    assert.equal(day.litres, 0, `empty day ${day.date} is a zero, not missing`);
  }
});

test('explicit ranges 7 and 90 return matching windows', async () => {
  const week = await dashboardService.milkProduction(7);
  assert.equal(week.range, 7);
  assert.equal(week.data.length, 7);
  assert.equal(week.data[0].date, addDays(today, -6));
  assert.equal(week.data[6].date, today);

  const quarter = await dashboardService.milkProduction(90);
  assert.equal(quarter.range, 90);
  assert.equal(quarter.data.length, 90);
  assert.equal(quarter.data[0].date, addDays(today, -89));
  assert.equal(quarter.data[89].date, today);
});

test('invalid ranges are rejected with a 400 HttpError', async () => {
  const invalid = [45, 0, -7, 6, 91, 7.5, 'abc', '', '7days', null, {}, []];
  for (const bad of invalid) {
    await assert.rejects(
      () => dashboardService.milkProduction(bad),
      (err) =>
        err.status === 400 &&
        /7, 30 or 90/.test(err.message) &&
        err.details &&
        typeof err.details.range === 'string',
      `range ${JSON.stringify(bad)} is rejected`
    );
  }
  const accepted = await dashboardService.milkProduction();
  assert.equal(accepted.range, 30, 'omitting the range falls back to the default');
  const numericString = await dashboardService.milkProduction('7');
  assert.equal(numericString.range, 7, 'stringified query values are coerced');
});

test('daily totals aggregate records, round to 3 decimals and zero-fill empty days', async () => {
  const d5 = addDays(today, -5);
  const d2 = addDays(today, -2);

  await milkService.create({ animal_id: trendAnimal.id, date: d5, session: 'morning', quantity: 10 });
  await milkService.create({ animal_id: trendAnimal.id, date: d5, session: 'evening', quantity: 5.5 });
  await milkService.create({ animal_id: secondAnimal.id, date: d5, session: 'morning', quantity: 2.25 });
  await milkService.create({ animal_id: trendAnimal.id, date: d2, session: 'morning', quantity: 3.3336 });
  await milkService.create({ animal_id: trendAnimal.id, date: today, session: 'morning', quantity: 7.25 });

  const series = await dashboardService.milkProduction(7);
  assert.equal(series.data.length, 7);
  assert.equal(serviceDay(series, d5).litres, 17.75, 'same-day records from both animals are summed');
  assert.equal(serviceDay(series, d2).litres, 3.334, 'totals round to 3 decimals');
  assert.equal(serviceDay(series, today).litres, 7.25, "today's total is included");
  assert.equal(serviceDay(series, addDays(today, -1)).litres, 0, 'a day without records stays a zero');
  assert.equal(serviceDay(series, addDays(today, -3)).litres, 0, 'a day without records stays a zero');
  assert.equal(serviceDay(series, addDays(today, -6)).litres, 0, 'a day without records stays a zero');

  const month = await dashboardService.milkProduction(30);
  assert.equal(serviceDay(month, d5).litres, 17.75, 'the 30-day window reports the same day');
  const sum = month.data.reduce((acc, d) => acc + d.litres, 0);
  assert.ok(Math.abs(sum - 28.334) < 1e-9, 'window total matches the recorded records');
});

test('foreign farm milk records are excluded from the trend', async () => {
  const beforeForeign = await dashboardService.milkProduction(7);

  connection.prepare("INSERT INTO farms (id, name) VALUES (999, 'Foreign Farm')").run();
  connection
    .prepare(
      `INSERT INTO animals (farm_id, tag_number, type, gender) VALUES (999, 'FOREIGN-TREND', 'cow', 'female')`
    )
    .run();
  const foreignAnimal = connection.prepare("SELECT id FROM animals WHERE farm_id = 999 AND tag_number = 'FOREIGN-TREND'").get();
  connection
    .prepare(
      `INSERT INTO milk_records (farm_id, animal_id, date, session, quantity, unit)
       VALUES (999, ?, ?, 'evening', 999, 'L')`
    )
    .run(foreignAnimal.id, today);

  const afterForeign = await dashboardService.milkProduction(7);
  assert.deepEqual(afterForeign, beforeForeign, 'another farm never changes this farm trend');

  connection.prepare('DELETE FROM farms WHERE id = 999').run();
  assert.equal(connection.prepare('SELECT COUNT(*) AS n FROM milk_records WHERE farm_id = 999').get().n, 0);
});

test('HTTP: range validation, default and payload shape', async () => {
  const week = await req('GET', '/dashboard/milk-production?range=7');
  assert.equal(week.status, 200);
  assert.equal(week.data.range, 7);
  assert.equal(week.data.unit, 'L');
  assert.equal(week.data.data.length, 7);
  assert.equal(week.data.data[6].date, today);
  assert.equal(week.data.data[6].litres, 7.25, "HTTP serves today's real total");

  const defaultRes = await req('GET', '/dashboard/milk-production');
  assert.equal(defaultRes.status, 200);
  assert.equal(defaultRes.data.range, 30, 'a missing range defaults to 30');
  assert.equal(defaultRes.data.data.length, 30);

  const quarter = await req('GET', '/dashboard/milk-production?range=90');
  assert.equal(quarter.status, 200);
  assert.equal(quarter.data.data.length, 90);

  const outOfSet = await req('GET', '/dashboard/milk-production?range=45');
  assert.equal(outOfSet.status, 400, 'range 45 is not allowed');
  assert.match(outOfSet.data.error, /7, 30 or 90/);
  assert.equal(typeof outOfSet.data.details.range, 'string');

  const notANumber = await req('GET', '/dashboard/milk-production?range=abc');
  assert.equal(notANumber.status, 400, 'non-numeric ranges are rejected');
});

test('HTTP: the trend agrees with the dashboard milk cards', async () => {
  const dashboard = await req('GET', '/dashboard');
  assert.equal(dashboard.status, 200);
  const trend = await req('GET', '/dashboard/milk-production?range=7');
  assert.equal(trend.status, 200);

  for (let i = 0; i < 7; i += 1) {
    const cardDay = dashboard.data.milk_last_7_days[i];
    const trendDay = trend.data.data[i];
    assert.equal(trendDay.date, cardDay.date, 'both series cover the same days');
    assert.ok(
      Math.abs(trendDay.litres - cardDay.total) <= 0.001,
      `day ${cardDay.date}: trend ${trendDay.litres} vs card ${cardDay.total}`
    );
  }

  const last = trend.data.data[6];
  assert.ok(
    Math.abs(last.litres - dashboard.data.metrics.milk_today) <= 0.001,
    'trend today matches the Milk Today card'
  );
  const trendSum = trend.data.data.reduce((acc, d) => acc + d.litres, 0);
  const cardSum = dashboard.data.milk_last_7_days.reduce((acc, d) => acc + d.total, 0);
  assert.ok(Math.abs(trendSum - cardSum) <= 0.01, 'seven-day totals match');
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

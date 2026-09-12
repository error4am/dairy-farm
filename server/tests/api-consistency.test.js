const os = require('os');
const path = require('path');
const fs = require('fs');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-api-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../index');
const db = require('../db/connection');
const { todayLocal, startOfWeek, startOfMonth, addDays } = require('../utils/date');

const EPS = 1e-9;
function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPS, `${message} (expected ${expected}, got ${actual})`);
}

const today = todayLocal();
const mondayWeek = startOfWeek(today, 'monday');
const monthStart = startOfMonth(today);

let base = '';
let server;

async function req(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test('start server on an ephemeral port', async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test('seed records over HTTP', async () => {
  const animal = await req('POST', '/animals', { tag_number: 'API-1', type: 'cow', gender: 'female' });
  assert.equal(animal.status, 201);

  const milk = [
    { animal_id: animal.data.id, date: today, session: 'morning', quantity: 12.5, unit: 'L' },
    { animal_id: animal.data.id, date: today, session: 'evening', quantity: 10.25, unit: 'L' },
    { animal_id: animal.data.id, date: addDays(today, -1), session: 'morning', quantity: 4, unit: 'L' },
    { animal_id: animal.data.id, date: addDays(today, -40), session: 'morning', quantity: 100, unit: 'L' }
  ];
  for (const record of milk) {
    const res = await req('POST', '/milk-records', record);
    assert.equal(res.status, 201, JSON.stringify(res.data));
  }

  const tx = [
    { date: today, type: 'income', category: 'milk_sale', amount: 1000.5, description: 'today income' },
    { date: today, type: 'expense', category: 'feed', amount: 250.25, description: 'today expense' },
    { date: mondayWeek, type: 'income', category: 'milk_sale', amount: 300, description: 'week start income' },
    { date: addDays(mondayWeek, -1), type: 'expense', category: 'labor', amount: 120.75, description: 'previous week' },
    { date: monthStart, type: 'income', category: 'other_income', amount: 50, description: 'month start' },
    { date: addDays(monthStart, -1), type: 'expense', category: 'medicine', amount: 75.5, description: 'previous month' },
    { date: addDays(today, -40), type: 'income', category: 'animal_sale', amount: 5000, description: 'old income' }
  ];
  for (const record of tx) {
    const res = await req('POST', '/transactions', record);
    assert.equal(res.status, 201, JSON.stringify(res.data));
  }
});

test('dashboard and finance endpoints report the same all-time totals', async () => {
  const dashboard = await req('GET', '/dashboard');
  const summary = await req('GET', '/transactions/summary');

  assert.equal(dashboard.status, 200);
  assert.equal(summary.status, 200);

  assertClose(dashboard.data.metrics.revenue_all_time, summary.data.all_time.income, 'revenue vs income');
  assertClose(dashboard.data.metrics.expenses_all_time, summary.data.all_time.expenses, 'expenses match');
  assertClose(dashboard.data.metrics.net_all_time, summary.data.all_time.net, 'net match');
  assert.equal(
    dashboard.data.metrics.net_all_time,
    dashboard.data.metrics.revenue_all_time - dashboard.data.metrics.expenses_all_time,
    'dashboard net identity'
  );
  assert.equal(
    summary.data.all_time.net,
    summary.data.all_time.income - summary.data.all_time.expenses,
    'finance net identity'
  );
});

test('range and all-time figures never mix on the finance endpoint', async () => {
  const range = await req(
    'GET',
    `/transactions/summary?from=${mondayWeek}&to=${today}`
  );
  assert.equal(range.status, 200);

  const expectedIncome = 1000.5 + 300;
  const expectedExpenses = 250.25;

  assertClose(range.data.range.income, expectedIncome, 'range income excludes out-of-range rows');
  assertClose(range.data.range.expenses, expectedExpenses, 'range expenses excludes out-of-range rows');
  assert.equal(range.data.range.net, range.data.range.income - range.data.range.expenses, 'range net identity');
  assert.ok(range.data.all_time.income > range.data.range.income, 'all-time income exceeds the range');
  assert.ok(range.data.all_time.expenses > range.data.range.expenses, 'all-time expenses exceed the range');
});

test('dashboard milk cards and milk endpoint agree on today and this week', async () => {
  const dashboard = await req('GET', '/dashboard');
  const milk = await req('GET', '/milk-records/summary');

  assertClose(dashboard.data.metrics.milk_today, 22.75, 'dashboard milk today');
  assertClose(milk.data.today.total, dashboard.data.metrics.milk_today, 'milk endpoint today matches dashboard');
  assertClose(milk.data.week, dashboard.data.metrics.milk_week, 'milk endpoint week matches dashboard');
  assert.equal(
    dashboard.data.metrics.milk_today,
    dashboard.data.metrics.milk_today_morning + dashboard.data.metrics.milk_today_evening,
    'morning plus evening equals today'
  );
});

after(() => {
  if (server) server.close();
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

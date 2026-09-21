const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.tmpdir(), `dairy-calc-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const db = require('../db/connection');
const animalService = require('../services/animalService');
const milkService = require('../services/milkService');
const financeService = require('../services/financeService');
const dashboardService = require('../services/dashboardService');
const settingsService = require('../services/settingsService');
const { todayLocal, startOfWeek, startOfMonth, addDays, lastNDates } = require('../utils/date');

const EPS = 1e-9;
function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPS, `${message} (expected ${expected}, got ${actual})`);
}
function sum(list, key) {
  return list.reduce((total, item) => total + item[key], 0);
}

const today = todayLocal();
const mondayWeek = startOfWeek(today, 'monday');
const sundayWeek = startOfWeek(today, 'sunday');
const monthStart = startOfMonth(today);

const milkFixtures = [];
const txFixtures = [];

const inRange = (date, from, to) => date >= from && date <= to;

test('empty database produces zero totals and zero net', async () => {
  const totals = await financeService.totals();
  assert.equal(totals.income, 0);
  assert.equal(totals.expenses, 0);
  assert.equal(totals.net, 0);

  const dashboard = await dashboardService.get();
  assert.equal(dashboard.metrics.revenue_all_time, 0);
  assert.equal(dashboard.metrics.expenses_all_time, 0);
  assert.equal(dashboard.metrics.net_all_time, 0);
  assert.equal(dashboard.metrics.milk_today, 0);
  assert.equal(dashboard.metrics.milk_week, 0);
  assert.equal(dashboard.metrics.active_animals, 0);

  const summary = await financeService.summary();
  assert.equal(summary.range.net, 0);
  assert.equal(summary.all_time.net, 0);
});

test('seed fixtures', async () => {
  const a = await animalService.create({ tag_number: 'T-1', type: 'cow', gender: 'female' });
  const b = await animalService.create({ tag_number: 'T-2', type: 'buffalo', gender: 'female' });

  const milk = [
    { animal_id: a.id, date: today, session: 'morning', quantity: 12.5, unit: 'L' },
    { animal_id: a.id, date: today, session: 'evening', quantity: 10.25, unit: 'L' },
    { animal_id: b.id, date: today, session: 'morning', quantity: 8, unit: 'L' },
    { animal_id: a.id, date: addDays(today, -1), session: 'morning', quantity: 4.25, unit: 'L' },
    { animal_id: b.id, date: addDays(today, -1), session: 'evening', quantity: 6.5, unit: 'L' },
    { animal_id: a.id, date: addDays(today, -40), session: 'morning', quantity: 100, unit: 'L' },
    { animal_id: b.id, date: addDays(today, 3), session: 'morning', quantity: 9, unit: 'L' }
  ];
  for (const record of milk) {
    await milkService.create(record);
    milkFixtures.push(record);
  }

  const tx = [
    { date: today, type: 'income', category: 'milk_sale', amount: 1000.5, description: 'today income' },
    { date: today, type: 'expense', category: 'feed', amount: 250.25, description: 'today expense' },
    { date: mondayWeek, type: 'income', category: 'milk_sale', amount: 300, description: 'week start income' },
    { date: addDays(mondayWeek, -1), type: 'expense', category: 'labor', amount: 120.75, description: 'previous week expense' },
    { date: monthStart, type: 'income', category: 'other_income', amount: 50, description: 'month start income' },
    { date: addDays(monthStart, -1), type: 'expense', category: 'medicine', amount: 75.5, description: 'previous month expense' },
    { date: addDays(today, -40), type: 'income', category: 'animal_sale', amount: 5000, description: 'old income' }
  ];
  for (const record of tx) {
    await financeService.create(record);
    txFixtures.push(record);
  }

  assert.equal((await dashboardService.get()).metrics.active_animals, 2);
});

test('all-time totals sum every transaction and net equals income minus expenses', async () => {
  const totals = await financeService.totals();
  assertClose(totals.income, sum(txFixtures.filter((t) => t.type === 'income'), 'amount'), 'all-time income');
  assertClose(totals.expenses, sum(txFixtures.filter((t) => t.type === 'expense'), 'amount'), 'all-time expenses');
  assert.equal(totals.net, totals.income - totals.expenses, 'net identity');
  assert.equal(totals.count, txFixtures.length);
});

test('range totals only include transactions inside the range and net matches that range', async () => {
  const range = await financeService.totals({ from: mondayWeek, to: today });
  const expectedIncome = sum(
    txFixtures.filter((t) => t.type === 'income' && inRange(t.date, mondayWeek, today)),
    'amount'
  );
  const expectedExpenses = sum(
    txFixtures.filter((t) => t.type === 'expense' && inRange(t.date, mondayWeek, today)),
    'amount'
  );

  assertClose(range.income, expectedIncome, 'range income');
  assertClose(range.expenses, expectedExpenses, 'range expenses');
  assert.equal(range.net, range.income - range.expenses, 'range net identity');
  assert.equal(range.from, mondayWeek);
  assert.equal(range.to, today);

  const outside = txFixtures.filter((t) => !inRange(t.date, mondayWeek, today));
  assert.ok(outside.length > 0, 'fixture must contain transactions outside the range');
  assert.ok(range.count < txFixtures.length, 'range count excludes transactions outside the range');
});

test('finance summary range matches totals and all_time matches un-ranged totals', async () => {
  const summary = await financeService.summary({ from: monthStart, to: today });
  const range = await financeService.totals({ from: monthStart, to: today });
  const all = await financeService.totals();

  assertClose(summary.range.income, range.income, 'summary range income');
  assertClose(summary.range.expenses, range.expenses, 'summary range expenses');
  assert.equal(summary.range.net, summary.range.income - summary.range.expenses, 'summary range net identity');
  assertClose(summary.all_time.income, all.income, 'summary all-time income');
  assertClose(summary.all_time.expenses, all.expenses, 'summary all-time expenses');
  assert.equal(summary.all_time.net, summary.all_time.income - summary.all_time.expenses, 'summary all-time net identity');

  const incomeByCategory = sum(summary.by_category.filter((c) => c.type === 'income'), 'amount');
  const expenseByCategory = sum(summary.by_category.filter((c) => c.type === 'expense'), 'amount');
  assertClose(incomeByCategory, summary.range.income, 'category breakdown sums to range income');
  assertClose(expenseByCategory, summary.range.expenses, 'category breakdown sums to range expenses');
});

test('dashboard all-time finance cards match the finance all-time totals exactly', async () => {
  const dashboard = await dashboardService.get();
  const all = await financeService.totals();
  const summary = await financeService.summary();

  assertClose(dashboard.metrics.revenue_all_time, all.income, 'dashboard revenue vs totals');
  assertClose(dashboard.metrics.expenses_all_time, all.expenses, 'dashboard expenses vs totals');
  assert.equal(
    dashboard.metrics.net_all_time,
    dashboard.metrics.revenue_all_time - dashboard.metrics.expenses_all_time,
    'dashboard net identity'
  );
  assertClose(dashboard.metrics.revenue_all_time, summary.all_time.income, 'dashboard revenue vs finance summary');
  assertClose(dashboard.metrics.expenses_all_time, summary.all_time.expenses, 'dashboard expenses vs finance summary');
  assert.equal(dashboard.metrics.net_all_time, summary.all_time.net, 'dashboard net vs finance summary');
});

test('dashboard milk cards use the record date and split morning/evening correctly', async () => {
  const dashboard = await dashboardService.get();
  const todayRecords = milkFixtures.filter((m) => m.date === today);

  assertClose(dashboard.metrics.milk_today, sum(todayRecords, 'quantity'), 'milk today');
  assertClose(
    dashboard.metrics.milk_today_morning,
    sum(todayRecords.filter((m) => m.session === 'morning'), 'quantity'),
    'milk today morning'
  );
  assertClose(
    dashboard.metrics.milk_today_evening,
    sum(todayRecords.filter((m) => m.session === 'evening'), 'quantity'),
    'milk today evening'
  );
  assert.equal(
    dashboard.metrics.milk_today,
    dashboard.metrics.milk_today_morning + dashboard.metrics.milk_today_evening,
    'morning plus evening equals today'
  );
});

test('dashboard week total respects the farm week start, matches the milk page and excludes future dates', async () => {
  const expectedMonday = sum(milkFixtures.filter((m) => inRange(m.date, mondayWeek, today)), 'quantity');
  assertClose((await dashboardService.get()).metrics.milk_week, expectedMonday, 'monday week total');
  assertClose((await milkService.summary({})).week, expectedMonday, 'milk page week matches dashboard');

  try {
    await settingsService.update({ name: 'Test Farm', currency: 'PKR', milk_unit: 'L', week_start: 'sunday', gestation_days: 283 });
    const expectedSunday = sum(milkFixtures.filter((m) => inRange(m.date, sundayWeek, today)), 'quantity');
    assertClose((await dashboardService.get()).metrics.milk_week, expectedSunday, 'sunday week total');
    assertClose((await milkService.summary({})).week, expectedSunday, 'milk page sunday week matches dashboard');
  } finally {
    await settingsService.update({ name: 'Test Farm', currency: 'PKR', milk_unit: 'L', week_start: 'monday', gestation_days: 283 });
  }

  const futureRecords = milkFixtures.filter((m) => m.date > today);
  assert.ok(futureRecords.length > 0, 'fixture must contain a future-dated record');
  assert.ok(
    (await dashboardService.get()).metrics.milk_week < sum(milkFixtures, 'quantity'),
    'future-dated record is excluded from the week total'
  );
});

test('milk summary range, today, week and month are consistent with the records', async () => {
  const summary = await milkService.summary({ from: monthStart, to: today });
  const expectedRange = sum(milkFixtures.filter((m) => inRange(m.date, monthStart, today)), 'quantity');
  const expectedToday = sum(milkFixtures.filter((m) => m.date === today), 'quantity');
  const expectedWeek = sum(milkFixtures.filter((m) => inRange(m.date, mondayWeek, today)), 'quantity');

  assertClose(summary.range.total, expectedRange, 'range total');
  assertClose(summary.range.morning + summary.range.evening, summary.range.total, 'range morning + evening');
  assertClose(summary.today.total, expectedToday, 'today total');
  assertClose(summary.week, expectedWeek, 'week total');
  assertClose(summary.month, expectedRange, 'month total equals range when range is the current month');

  assert.ok(sum(milkFixtures.filter((m) => m.date > today), 'quantity') > 0, 'future fixture present');
  assert.ok(summary.month < sum(milkFixtures, 'quantity'), 'future record excluded from month');

  assertClose(sum(summary.by_animal, 'total'), expectedRange, 'by-animal sums to range');
  assertClose(sum(summary.by_day, 'total'), expectedRange, 'by-day sums to range');
});

test('last-7-days series has 7 buckets, zero-fills gaps and ends today', async () => {
  const dashboard = await dashboardService.get();
  const dates = lastNDates(7, today);

  assert.equal(dashboard.milk_last_7_days.length, 7);
  assert.deepEqual(
    dashboard.milk_last_7_days.map((d) => d.date),
    dates
  );
  assertClose(
    dashboard.milk_last_7_days[6].total,
    sum(milkFixtures.filter((m) => m.date === today), 'quantity'),
    'last bucket is today'
  );
  assertClose(
    sum(dashboard.milk_last_7_days, 'total'),
    sum(milkFixtures.filter((m) => inRange(m.date, dates[0], today)), 'quantity'),
    'series window total'
  );
});

test('deleting a transaction updates range, all-time and dashboard consistently', async () => {
  const beforeAll = await financeService.totals();
  const beforeRange = await financeService.totals({ from: mondayWeek, to: today });

  const list = await financeService.list({ from: mondayWeek, to: today, limit: 1 });
  const target = list.items[0];
  await financeService.remove(target.id);

  const afterAll = await financeService.totals();
  const afterRange = await financeService.totals({ from: mondayWeek, to: today });

  const incomeDelta = target.type === 'income' ? target.amount : 0;
  const expenseDelta = target.type === 'expense' ? target.amount : 0;

  assertClose(afterAll.income, beforeAll.income - incomeDelta, 'all-time income after deletion');
  assertClose(afterAll.expenses, beforeAll.expenses - expenseDelta, 'all-time expenses after deletion');
  assert.equal(afterAll.net, afterAll.income - afterAll.expenses, 'all-time net identity');

  assertClose(afterRange.income, beforeRange.income - incomeDelta, 'range income after deletion');
  assertClose(afterRange.expenses, beforeRange.expenses - expenseDelta, 'range expenses after deletion');
  assert.equal(afterRange.net, afterRange.income - afterRange.expenses, 'range net identity');

  const dashboard = await dashboardService.get();
  assertClose(dashboard.metrics.revenue_all_time, afterAll.income, 'dashboard reflects deletion');
  assert.equal(
    dashboard.metrics.net_all_time,
    dashboard.metrics.revenue_all_time - dashboard.metrics.expenses_all_time,
    'dashboard net identity after deletion'
  );
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

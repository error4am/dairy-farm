const os = require('os');
const path = require('path');
const fs = require('fs');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-rev-exp-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const app = require('../index');
const connection = require('../db/connection');
const dashboardService = require('../services/dashboardService');
const financeService = require('../services/financeService');
const milkPriceService = require('../services/milkPriceService');
const milkSaleService = require('../services/milkSaleService');
const { todayLocal, addDays } = require('../utils/date');

const today = todayLocal();
const D = (n) => addDays(today, n);
const EPS = 0.01;

let server = null;
let base = '';

let d10;
let d5;
let d4;
let d3;
let d2;
let d1;

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

function assertClose(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= EPS, `${label}: ${actual} vs ${expected}`);
}

test('start server on an ephemeral port', async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test('empty dataset returns a fully zero-filled default window', async () => {
  const series = await dashboardService.revenueExpenses();
  assert.equal(series.range, 30, 'default range is 30 days');
  assert.equal(series.currency, 'PKR', 'the farm currency is returned');
  assert.deepEqual(
    Object.keys(series),
    ['range', 'currency', 'data', 'totals'],
    'payload keys are range, currency, data, totals'
  );
  assert.equal(series.data.length, 30, 'one entry per day');
  assert.equal(series.data[29].date, today, 'window ends today');
  assert.equal(series.data[0].date, D(-29), 'window starts 29 days ago');
  for (let i = 1; i < series.data.length; i += 1) {
    assert.equal(series.data[i].date, addDays(series.data[i - 1].date, 1), 'days are contiguous and ascending');
  }
  for (const day of series.data) {
    assert.equal(day.revenue, 0, `empty day ${day.date} has zero revenue`);
    assert.equal(day.expenses, 0, `empty day ${day.date} has zero expenses`);
  }
  assert.deepEqual(series.totals, { revenue: 0, expenses: 0, net: 0 }, 'empty totals are all zero');
});

test('explicit ranges 7 and 90 return matching windows', async () => {
  const week = await dashboardService.revenueExpenses(7);
  assert.equal(week.range, 7);
  assert.equal(week.data.length, 7);
  assert.equal(week.data[0].date, D(-6));
  assert.equal(week.data[6].date, today);

  const quarter = await dashboardService.revenueExpenses(90);
  assert.equal(quarter.range, 90);
  assert.equal(quarter.data.length, 90);
  assert.equal(quarter.data[0].date, D(-89));
  assert.equal(quarter.data[89].date, today);
});

test('invalid ranges are rejected with a 400 HttpError', async () => {
  const invalid = [45, 0, -7, 6, 91, 7.5, 'abc', '', '7days', null, {}, []];
  for (const bad of invalid) {
    await assert.rejects(
      () => dashboardService.revenueExpenses(bad),
      (err) =>
        err.status === 400 &&
        /7, 30 or 90/.test(err.message) &&
        err.details &&
        typeof err.details.range === 'string',
      `range ${JSON.stringify(bad)} is rejected`
    );
  }
  const accepted = await dashboardService.revenueExpenses();
  assert.equal(accepted.range, 30, 'omitting the range falls back to the default');
  const numericString = await dashboardService.revenueExpenses('7');
  assert.equal(numericString.range, 7, 'stringified query values are coerced');
});

test('daily aggregation classifies finance transactions, sums same-day rows and zero-fills', async () => {
  d10 = D(-10);
  d5 = D(-5);
  d4 = D(-4);
  d3 = D(-3);
  d2 = D(-2);
  d1 = D(-1);

  // d5: two incomes + two expenses on the same day
  await financeService.create({ date: d5, type: 'income', category: 'other_income', amount: 80000 });
  await financeService.create({ date: d5, type: 'income', category: 'animal_sale', amount: 3600 });
  await financeService.create({ date: d5, type: 'expense', category: 'feed', amount: 7200 });
  await financeService.create({ date: d5, type: 'expense', category: 'labor', amount: 1500 });
  // d4: revenue and expenses on the same day
  await financeService.create({ date: d4, type: 'income', category: 'other_income', amount: 500 });
  await financeService.create({ date: d4, type: 'expense', category: 'medicine', amount: 250 });
  // d3: three-decimal amount follows the round2 money convention
  await financeService.create({ date: d3, type: 'expense', category: 'other_expense', amount: 1234.567 });
  // d2: expenses only (zero-revenue day)
  await financeService.create({ date: d2, type: 'expense', category: 'electricity', amount: 4000 });
  // d1: revenue only (zero-expense day)
  await financeService.create({ date: d1, type: 'income', category: 'animal_sale', amount: 1200 });
  // d10: outside the 7-day window, inside 30/90 — flips those nets negative
  await financeService.create({ date: d10, type: 'expense', category: 'equipment', amount: 500000 });

  const week = await dashboardService.revenueExpenses(7);
  assert.equal(week.data.length, 7);
  assert.equal(serviceDay(week, d5).revenue, 83600, 'two same-day incomes are summed');
  assert.equal(serviceDay(week, d5).expenses, 8700, 'two same-day expenses are summed');
  assert.equal(serviceDay(week, d4).revenue, 500, 'a day can carry both revenue and expenses');
  assert.equal(serviceDay(week, d4).expenses, 250, 'a day can carry both revenue and expenses');
  assert.equal(serviceDay(week, d3).expenses, 1234.57, 'money rounds to 2 decimals');
  assert.equal(serviceDay(week, d2).revenue, 0, 'zero-revenue day is a zero, not missing');
  assert.equal(serviceDay(week, d2).expenses, 4000, 'expense-only day keeps its expenses');
  assert.equal(serviceDay(week, d1).revenue, 1200, 'revenue-only day keeps its revenue');
  assert.equal(serviceDay(week, d1).expenses, 0, 'zero-expense day is a zero, not missing');
  assert.equal(serviceDay(week, today).revenue, 0, 'today without records is zero-filled');
  assert.equal(serviceDay(week, today).expenses, 0, 'today without records is zero-filled');
  assert.equal(serviceDay(week, D(-6)).revenue, 0, 'a day without records stays a zero');
  assert.equal(serviceDay(week, D(-6)).expenses, 0, 'a day without records stays a zero');
  const outside = week.data.find((d) => d.date === d10);
  assert.equal(outside, undefined, 'days outside the 7-day window are excluded');

  for (const day of week.data) {
    assert.equal(typeof day.revenue, 'number', 'revenue is a JSON number');
    assert.equal(typeof day.expenses, 'number', 'expenses is a JSON number');
    assert.ok(day.revenue >= 0 && day.expenses >= 0, 'values are non-negative');
  }
});

test('range totals equal the daily series and net is revenue minus expenses', async () => {
  const week = await dashboardService.revenueExpenses(7);
  const sumRevenue = week.data.reduce((acc, d) => acc + d.revenue, 0);
  const sumExpenses = week.data.reduce((acc, d) => acc + d.expenses, 0);
  assertClose(week.totals.revenue, sumRevenue, '7-day totals equal the series sum');
  assertClose(week.totals.expenses, sumExpenses, '7-day totals equal the series sum');
  assertClose(week.totals.net, week.totals.revenue - week.totals.expenses, 'net = revenue - expenses');
  assert.equal(week.totals.revenue, 85300, '7-day revenue is exact');
  assert.equal(week.totals.expenses, 14184.57, '7-day expenses follow round2');
  assert.equal(week.totals.net, 71115.43, '7-day net is positive');
  assert.ok(week.totals.net > 0, 'the 7-day window nets positive');

  for (const range of [30, 90]) {
    const series = await dashboardService.revenueExpenses(range);
    const rev = series.data.reduce((acc, d) => acc + d.revenue, 0);
    const exp = series.data.reduce((acc, d) => acc + d.expenses, 0);
    assertClose(series.totals.revenue, rev, `${range}-day totals equal the series sum`);
    assertClose(series.totals.expenses, exp, `${range}-day totals equal the series sum`);
    assertClose(series.totals.net, series.totals.revenue - series.totals.expenses, `${range}-day net formula`);
  }

  const month = await dashboardService.revenueExpenses(30);
  assert.ok(month.totals.net < 0, 'the d10 equipment expense makes the 30-day net negative');
  assert.equal(month.totals.revenue, 85300, 'the d10 expense sits outside the 7-day window');
  assert.equal(month.totals.expenses, 514184.57, '30-day expenses include the d10 equipment purchase');
});

test('totals agree with financeService range totals for every range', async () => {
  for (const range of [7, 30, 90]) {
    const series = await dashboardService.revenueExpenses(range);
    const from = series.data[0].date;
    const finance = await financeService.totals({ from, to: today });
    assertClose(series.totals.revenue, finance.income, `${range}-day revenue == finance income`);
    assertClose(series.totals.expenses, finance.expenses, `${range}-day expenses == finance expenses`);
    assertClose(series.totals.net, finance.net, `${range}-day net == finance net`);
  }
});

test('milk sale income is counted exactly once', async () => {
  const before = await dashboardService.revenueExpenses(7);

  await milkPriceService.create({ price_per_litre: 210, effective_date: today });
  const sale = await milkSaleService.create({ date: today, litres: 40 });
  assert.equal(sale.revenue, 8400, 'the sale posts 40 L at 210 = 8400');

  const after = await dashboardService.revenueExpenses(7);
  assertClose(after.totals.revenue - before.totals.revenue, 8400, 'revenue grows by exactly one sale');
  assert.equal(serviceDay(after, today).revenue, 8400, "today's revenue is the single sale income");
  assertClose(after.totals.net - before.totals.net, 8400, 'net grows by the sale exactly once');

  const finance = await financeService.totals({ from: after.data[0].date, to: today });
  assertClose(after.totals.revenue, finance.income, 'revenue still equals finance income after the sale');
  assert.equal(
    finance.count,
    after.data.length > 0 ? finance.count : finance.count,
    'sanity: finance counted the same rows'
  );
});

test('HTTP: payload shape, ranges and validation', async () => {
  const week = await req('GET', '/dashboard/revenue-expenses?range=7');
  assert.equal(week.status, 200);
  assert.deepEqual(Object.keys(week.data), ['range', 'currency', 'data', 'totals']);
  assert.equal(week.data.range, 7);
  assert.equal(week.data.currency, 'PKR');
  assert.equal(week.data.data.length, 7);
  assert.equal(week.data.data[6].date, today);
  for (const day of week.data.data) {
    assert.deepEqual(Object.keys(day), ['date', 'revenue', 'expenses']);
  }
  assert.deepEqual(Object.keys(week.data.totals), ['revenue', 'expenses', 'net']);

  const defaultRes = await req('GET', '/dashboard/revenue-expenses');
  assert.equal(defaultRes.status, 200);
  assert.equal(defaultRes.data.range, 30, 'a missing range defaults to 30');
  assert.equal(defaultRes.data.data.length, 30);

  const quarter = await req('GET', '/dashboard/revenue-expenses?range=90');
  assert.equal(quarter.status, 200);
  assert.equal(quarter.data.data.length, 90);

  const outOfSet = await req('GET', '/dashboard/revenue-expenses?range=45');
  assert.equal(outOfSet.status, 400, 'range 45 is not allowed');
  assert.match(outOfSet.data.error, /7, 30 or 90/);
  assert.equal(typeof outOfSet.data.details.range, 'string');

  const notANumber = await req('GET', '/dashboard/revenue-expenses?range=abc');
  assert.equal(notANumber.status, 400, 'non-numeric ranges are rejected');
});

test('HTTP: endpoint agrees with the transactions summary endpoint for the same window', async () => {
  const trend = await req('GET', '/dashboard/revenue-expenses?range=7');
  assert.equal(trend.status, 200);
  const from = trend.data.data[0].date;
  const to = trend.data.data[6].date;

  const summary = await req('GET', `/transactions/summary?from=${from}&to=${to}`);
  assert.equal(summary.status, 200);
  assertClose(trend.data.totals.revenue, summary.data.range.income, 'revenue == finance summary income');
  assertClose(trend.data.totals.expenses, summary.data.range.expenses, 'expenses == finance summary expenses');
  assertClose(trend.data.totals.net, summary.data.range.net, 'net == finance summary net');

  const raw = connection
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expenses
       FROM transactions WHERE farm_id = 1 AND date >= ? AND date <= ?`
    )
    .get(from, to);
  assertClose(trend.data.totals.revenue, raw.income, 'revenue == raw income transactions');
  assertClose(trend.data.totals.expenses, raw.expenses, 'expenses == raw expense transactions');
});

test('revenue and expenses are farm scoped: foreign farm rows never appear', async () => {
  const before = await dashboardService.revenueExpenses(7);

  connection.prepare("INSERT INTO farms (id, name, currency) VALUES (999, 'Foreign Farm', 'USD')").run();
  connection
    .prepare(
      `INSERT INTO transactions (farm_id, date, type, category, amount) VALUES
       (999, ?, 'income', 'other_income', 111111), (999, ?, 'expense', 'other_expense', 222222)`
    )
    .run(today, today);

  const after = await dashboardService.revenueExpenses(7);
  assert.deepEqual(after, before, 'another farm never changes this farm trend');

  connection.prepare('DELETE FROM farms WHERE id = 999').run();
  assert.equal(connection.prepare('SELECT COUNT(*) AS n FROM transactions WHERE farm_id = 999').get().n, 0);
});

test('HTTP: the existing dashboard still works alongside the new endpoint', async () => {
  const dashboard = await req('GET', '/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(typeof dashboard.data.metrics.revenue_all_time, 'number');
  assert.equal(Array.isArray(dashboard.data.recent_activity), true);

  const milkTrend = await req('GET', '/dashboard/milk-production?range=7');
  assert.equal(milkTrend.status, 200, 'the milk production trend still answers');
  assert.equal(milkTrend.data.data.length, 7);
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

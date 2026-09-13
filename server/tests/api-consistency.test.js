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

test('health API blocks milk during withdrawal and matches the dashboard strip', async () => {
  const animal = await req('POST', '/animals', { tag_number: 'API-H1', type: 'cow', gender: 'female' });
  assert.equal(animal.status, 201);

  const health = await req('POST', '/health-records', {
    animal_id: animal.data.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    medicine: 'Amoxicillin',
    withdrawal_until: addDays(today, 5),
    cost: 500
  });
  assert.equal(health.status, 201, JSON.stringify(health.data));
  assertClose(health.data.cost, 500, 'linked expense amount');

  const blocked = await req('POST', '/milk-records', {
    animal_id: animal.data.id,
    date: today,
    session: 'morning',
    quantity: 5,
    unit: 'L'
  });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error, /withdrawal/i);

  const dashboard = await req('GET', '/dashboard');
  const summary = await req('GET', '/health-records/summary');
  assert.equal(dashboard.data.metrics.health.withdrawal_count, summary.data.withdrawal_count);
  assert.equal(dashboard.data.metrics.health.due_soon_count, summary.data.due_soon_count);
  assert.equal(dashboard.data.metrics.health.events_this_month, summary.data.events_this_month);
  assert.equal(dashboard.data.metrics.health.withdrawal_count, 1);

  const finance = await req('GET', '/transactions/summary');
  assertClose(finance.data.all_time.expenses, 250.25 + 120.75 + 75.5 + 500, 'auto expense included in totals');
});

test('breeding API records a pregnancy and matches the dashboard strip', async () => {
  const animal = await req('POST', '/animals', { tag_number: 'API-B1', type: 'cow', gender: 'female' });
  assert.equal(animal.status, 201);

  const record = await req('POST', '/breeding-records', {
    animal_id: animal.data.id,
    heat_date: addDays(today, -20),
    service_date: addDays(today, -18),
    service_method: 'artificial_insemination',
    pregnancy_check_date: addDays(today, -2),
    pregnancy_result: 'pregnant',
    expected_calving_date: addDays(today, 265),
    expected_calving_estimated: true
  });
  assert.equal(record.status, 201, JSON.stringify(record.data));
  assert.equal(record.data.expected_calving_estimated, 1);

  const dashboard = await req('GET', '/dashboard');
  const summary = await req('GET', '/breeding-records/summary');
  assert.equal(dashboard.data.metrics.breeding.currently_pregnant, summary.data.currently_pregnant_count);
  assert.equal(dashboard.data.metrics.breeding.calving_soon, summary.data.calving_soon_count);
  assert.equal(dashboard.data.metrics.breeding.pending_checks, summary.data.pending_checks_count);
  assert.equal(dashboard.data.metrics.breeding.currently_pregnant, 1);
  assert.equal(summary.data.currently_pregnant[0].animal_tag, 'API-B1');
});

test('employee API creates a linked labor expense and dashboard matches finance', async () => {
  const employee = await req('POST', '/employees', {
    name: 'API Worker',
    role: 'Milker',
    pay_type: 'monthly',
    salary: 30000,
    joining_date: today
  });
  assert.equal(employee.status, 201, JSON.stringify(employee.data));
  assert.match(employee.data.employee_id, /^EMP-/);

  const payment = await req('POST', '/employee-payments', {
    employee_id: employee.data.id,
    date: today,
    type: 'salary',
    amount: 30000
  });
  assert.equal(payment.status, 201, JSON.stringify(payment.data));
  assert.ok(payment.data.transaction_id);

  const financeList = await req('GET', `/transactions?category=labor&from=${monthStart}&to=${today}&limit=200`);
  const linked = financeList.data.items.find((t) => t.id === payment.data.transaction_id);
  assert.ok(linked, 'linked labor expense appears in finance list');
  assert.equal(linked.employee_name, 'API Worker');
  assert.equal(linked.category, 'labor');

  const laborTotal = financeList.data.items.reduce((sum, t) => sum + t.amount, 0);
  const dashboard = await req('GET', '/dashboard');
  assertClose(dashboard.data.metrics.employees.labor_cost_this_month, laborTotal, 'dashboard labor cost matches finance');
  assert.equal(dashboard.data.metrics.employees.active_count, 1);

  const summary = await req('GET', '/employees/summary');
  assert.equal(summary.data.active_count, 1);

  const directEdit = await req('PUT', `/transactions/${payment.data.transaction_id}`, {
    date: today,
    type: 'expense',
    category: 'labor',
    amount: 999
  });
  assert.equal(directEdit.status, 409, 'HTTP finance edit of linked payment is blocked');
  assert.match(directEdit.data.error, /employee payment/i);

  const directDelete = await req('DELETE', `/transactions/${payment.data.transaction_id}`);
  assert.equal(directDelete.status, 409, 'HTTP finance delete of linked payment is blocked');
});

after(() => {
  if (server) server.close();
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

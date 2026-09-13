const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.tmpdir(), `dairy-linked-tx-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const db = require('../db/connection');
const animalService = require('../services/animalService');
const employeeService = require('../services/employeeService');
const paymentService = require('../services/paymentService');
const healthService = require('../services/healthService');
const financeService = require('../services/financeService');
const dashboardService = require('../services/dashboardService');
const { todayLocal, startOfMonth } = require('../utils/date');

const EPS = 1e-9;
function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPS, `${message} (expected ${expected}, got ${actual})`);
}

const today = todayLocal();

test('employee payment is the single source of truth from 40,000 to 35,000 on every surface', () => {
  const employee = employeeService.create({
    name: 'Ali',
    role: 'Milker',
    joining_date: today,
    status: 'active',
    pay_type: 'monthly',
    salary: 40000
  });
  const payment = paymentService.create({
    employee_id: employee.id,
    date: today,
    type: 'salary',
    amount: 40000,
    description: 'September salary'
  });

  assertClose(employeeService.profile(employee.id).finance.total_paid, 40000, 'profile total before change');
  assertClose(financeService.totals().expenses, 40000, 'finance total before change');
  assertClose(dashboardService.get().metrics.employees.labor_cost_this_month, 40000, 'dashboard before change');

  assert.throws(
    () =>
      financeService.update(payment.transaction_id, {
        date: today,
        type: 'expense',
        category: 'labor',
        amount: 35000,
        description: 'Direct finance edit'
      }),
    (err) => err.status === 409 && /employee payment/i.test(err.message),
    'direct finance edit of a linked payment expense is rejected'
  );
  assert.throws(
    () => financeService.remove(payment.transaction_id),
    (err) => err.status === 409 && /employee payment/i.test(err.message),
    'direct finance delete of a linked payment expense is rejected'
  );

  const updated = paymentService.update(payment.id, {
    employee_id: employee.id,
    date: today,
    type: 'salary',
    amount: 35000,
    description: 'September salary'
  });
  assertClose(updated.amount, 35000, 'payment updated at the source');

  const profile = employeeService.profile(employee.id);
  assertClose(profile.finance.total_paid, 35000, 'profile total after change');
  assert.equal(profile.recent_payments.length, 1);
  assertClose(profile.recent_payments[0].amount, 35000, 'payment history after change');

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(updated.transaction_id);
  assertClose(tx.amount, 35000, 'linked finance transaction after change');

  const totals = financeService.totals();
  assertClose(totals.expenses, 35000, 'finance totals after change');
  assert.equal(totals.net, totals.income - totals.expenses, 'net identity holds');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 1, 'still exactly one expense');

  const monthLabor = financeService.totals({ from: startOfMonth(today), to: today, category: 'labor' }).expenses;
  assertClose(monthLabor, 35000, 'monthly labor total after change');
  assertClose(dashboardService.get().metrics.employees.labor_cost_this_month, 35000, 'dashboard after change');

  const list = financeService.list({ limit: 10 });
  assert.equal(list.items[0].employee_name, 'Ali', 'finance list still identifies the employee');
  assert.equal(list.items[0].health_record_id, null);
});

test('health-linked expenses are protected and propagate through the health record', () => {
  const animal = animalService.create({ tag_number: 'L-1', type: 'cow', gender: 'female' });
  const before = financeService.totals().expenses;

  const record = healthService.create({
    animal_id: animal.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    medicine: 'Amoxicillin',
    cost: 4000
  });
  assertClose(financeService.totals().expenses, before + 4000, 'health expense created');

  assert.throws(
    () =>
      financeService.update(record.transaction_id, {
        date: today,
        type: 'expense',
        category: 'medicine',
        amount: 3500
      }),
    (err) => err.status === 409 && /health record/i.test(err.message),
    'direct finance edit of a linked health expense is rejected'
  );
  assert.throws(
    () => financeService.remove(record.transaction_id),
    (err) => err.status === 409 && /health record/i.test(err.message),
    'direct finance delete of a linked health expense is rejected'
  );

  const list = financeService.list({ limit: 10 });
  const linked = list.items.find((t) => t.id === record.transaction_id);
  assert.ok(linked.health_record_id, 'finance list exposes the health link');
  assert.equal(linked.employee_id, null);

  const updated = healthService.update(record.id, {
    animal_id: animal.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    medicine: 'Amoxicillin',
    cost: 3500
  });
  assertClose(
    db.prepare('SELECT amount FROM transactions WHERE id = ?').get(updated.transaction_id).amount,
    3500,
    'transaction follows the health record'
  );
  assertClose(financeService.totals().expenses, before + 3500, 'finance totals follow the health record');

  healthService.remove(record.id);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE id = ?').get(updated.transaction_id).n,
    0,
    'deleting the health record removes the linked expense'
  );
  assertClose(financeService.totals().expenses, before, 'finance totals return to baseline');
});

test('manual transactions remain editable and deletable', () => {
  const tx = financeService.create({
    date: today,
    type: 'expense',
    category: 'feed',
    amount: 1000,
    description: 'Manual fodder expense'
  });

  const edited = financeService.update(tx.id, {
    date: today,
    type: 'expense',
    category: 'feed',
    amount: 1200,
    description: 'Manual fodder expense'
  });
  assert.equal(edited.amount, 1200);

  const result = financeService.remove(tx.id);
  assert.equal(result.ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE id = ?').get(tx.id).n, 0);
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

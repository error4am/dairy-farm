const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.tmpdir(), `dairy-employees-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const db = require('../db/connection');
const employeeService = require('../services/employeeService');
const paymentService = require('../services/paymentService');
const financeService = require('../services/financeService');
const dashboardService = require('../services/dashboardService');
const { todayLocal, addDays, startOfMonth } = require('../utils/date');

const EPS = 1e-9;
function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPS, `${message} (expected ${expected}, got ${actual})`);
}

const today = todayLocal();

let ali = null;
let ahmed = null;
let bilal = null;
let salaryPaymentId = null;
let advanceId = null;

test('creates employees with generated employee codes', () => {
  ali = employeeService.create({
    name: 'Ali',
    phone: '0300-1234567',
    role: 'Milker',
    joining_date: addDays(today, -90),
    status: 'active',
    pay_type: 'monthly',
    salary: 30000
  });
  ahmed = employeeService.create({ name: 'Ahmed', role: 'Feeder', pay_type: 'daily', salary: 1500 });
  bilal = employeeService.create({ name: 'Bilal', role: 'Guard', pay_type: 'monthly', salary: 35000 });

  assert.equal(ali.employee_id, 'EMP-001');
  assert.equal(ahmed.employee_id, 'EMP-002');
  assert.equal(bilal.employee_id, 'EMP-003');
  assert.equal(ali.status, 'active');
});

test('edits an employee', () => {
  const updated = employeeService.update(ahmed.id, {
    name: 'Ahmed Khan',
    phone: '0301-7654321',
    role: 'Feeder',
    joining_date: addDays(today, -30),
    status: 'active',
    pay_type: 'daily',
    salary: 1600
  });

  assert.equal(updated.name, 'Ahmed Khan');
  assert.equal(updated.salary, 1600);
  assert.equal(updated.employee_id, 'EMP-002', 'employee code is immutable');
});

test('deactivates an employee and excludes them from active lists by default', () => {
  const inactive = employeeService.update(bilal.id, {
    name: 'Bilal',
    role: 'Guard',
    joining_date: addDays(today, -200),
    status: 'inactive',
    pay_type: 'monthly',
    salary: 35000
  });

  assert.equal(inactive.status, 'inactive');
  assert.ok(!employeeService.list({ status: 'active' }).some((e) => e.id === bilal.id));
  assert.ok(employeeService.list({ status: 'inactive' }).some((e) => e.id === bilal.id));
  assert.equal(employeeService.summary().active_count, 2);
  assert.equal(employeeService.summary().inactive_count, 1);
});

test('search and filters work', () => {
  assert.equal(employeeService.list({ search: 'Ahmed' }).length, 1);
  assert.equal(employeeService.list({ search: 'EMP-00' }).length, 3);
  assert.equal(employeeService.list({ role: 'Milker' }).length, 1);
  assert.equal(employeeService.list({ role: 'Feeder', status: 'active' }).length, 1);
  assert.equal(employeeService.list({ status: 'inactive' }).length, 1);
});

test('invalid employee data is rejected', () => {
  assert.throws(
    () => employeeService.create({ pay_type: 'monthly', salary: 1000 }),
    (err) => err.status === 400 && Boolean(err.details.name),
    'name is required'
  );
  assert.throws(
    () => employeeService.create({ name: 'X', pay_type: 'weekly', salary: 1000 }),
    (err) => err.status === 400 && Boolean(err.details.pay_type),
    'pay type must be monthly or daily'
  );
  assert.throws(
    () => employeeService.create({ name: 'X', pay_type: 'monthly', salary: 1000, status: 'fired' }),
    (err) => err.status === 400 && Boolean(err.details.status),
    'status must be active or inactive'
  );
  assert.throws(
    () => employeeService.create({ name: 'X', pay_type: 'monthly', salary: -5 }),
    (err) => err.status === 400 && Boolean(err.details.salary),
    'negative salary rejected'
  );
  assert.throws(
    () => employeeService.create({ name: 'X', pay_type: 'monthly', salary: 1000, joining_date: 'not-a-date' }),
    (err) => err.status === 400 && Boolean(err.details.joining_date),
    'invalid joining date rejected'
  );
});

test('salary payment creates exactly one linked labor expense', () => {
  const before = financeService.totals();

  const payment = paymentService.create({
    employee_id: ali.id,
    date: today,
    type: 'salary',
    amount: 30000,
    description: 'September salary'
  });
  salaryPaymentId = payment.id;

  assert.equal(payment.employee_name, 'Ali');
  assert.ok(payment.transaction_id, 'linked transaction id is stored');

  const after = financeService.totals();
  assert.equal(after.count - before.count, 1, 'exactly one expense is created');
  assertClose(after.expenses - before.expenses, 30000, 'expense amount matches the payment');
  assert.equal(after.net, after.income - after.expenses, 'net identity holds');

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(payment.transaction_id);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.category, 'labor');
  assert.equal(tx.amount, 30000);
  assert.equal(tx.animal_id, null);
  assert.match(tx.description, /Salary payment/);
  assert.match(tx.description, /Ali/);

  const financeList = financeService.list({ limit: 10 });
  const item = financeList.items.find((t) => t.id === payment.transaction_id);
  assert.equal(item.employee_name, 'Ali', 'finance list identifies the employee');
  assert.equal(item.employee_code, 'EMP-001');
  assert.equal(item.payment_type, 'salary');
});

test('advance payment is linked, typed and identifiable', () => {
  const advance = paymentService.create({
    employee_id: ali.id,
    date: addDays(today, -2),
    type: 'advance',
    amount: 10000
  });
  advanceId = advance.id;

  assert.equal(advance.type, 'advance');
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(advance.transaction_id);
  assert.equal(tx.category, 'labor');
  assert.match(tx.description, /Advance/);
  assert.match(tx.description, /Ali/);

  const history = paymentService.list({ employee_id: ali.id });
  assert.equal(history.total, 2, 'both payments appear in history');
});

test('bonus payment is created and linked', () => {
  const bonus = paymentService.create({ employee_id: ahmed.id, date: today, type: 'bonus', amount: 2000 });
  assert.ok(bonus.transaction_id);
  assert.equal(bonus.type, 'bonus');

  paymentService.remove(bonus.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE id = ?').get(bonus.transaction_id).n, 0);
});

test('editing a payment updates the linked expense without duplicating it', () => {
  const beforeCount = financeService.totals().count;

  const edited = paymentService.update(salaryPaymentId, {
    employee_id: ali.id,
    date: addDays(today, -1),
    type: 'salary',
    amount: 35000,
    description: 'Corrected salary'
  });

  assert.equal(edited.amount, 35000);
  assert.equal(financeService.totals().count, beforeCount, 'no duplicate expense on edit');

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(edited.transaction_id);
  assert.equal(tx.amount, 35000);
  assert.equal(tx.date, addDays(today, -1));
});

test('deleting a payment deletes its linked expense', () => {
  const before = financeService.totals();
  const advancePaymentId = advanceId;

  paymentService.remove(advancePaymentId);

  const after = financeService.totals();
  assert.equal(after.count, before.count - 1, 'expense removed with the payment');
  assertClose(after.expenses, before.expenses - 10000, 'expense total drops by the advance');
  assert.equal(after.net, after.income - after.expenses, 'net identity holds');

  const payment = db.prepare('SELECT * FROM employee_payments WHERE id = ?').get(advancePaymentId);
  assert.equal(payment, undefined);
});

test('zero, negative and missing amounts are rejected', () => {
  assert.throws(
    () => paymentService.create({ employee_id: ali.id, date: today, type: 'salary', amount: 0 }),
    (err) => err.status === 400 && Boolean(err.details.amount),
    'zero rejected'
  );
  assert.throws(
    () => paymentService.create({ employee_id: ali.id, date: today, type: 'salary', amount: -100 }),
    (err) => err.status === 400 && Boolean(err.details.amount),
    'negative rejected'
  );
  assert.throws(
    () => paymentService.create({ employee_id: ali.id, date: today, type: 'salary' }),
    (err) => err.status === 400 && Boolean(err.details.amount),
    'missing amount rejected'
  );
});

test('payments must reference an existing employee', () => {
  assert.throws(
    () => paymentService.create({ employee_id: 9999, date: today, type: 'salary', amount: 1000 }),
    (err) => err.status === 400 && Boolean(err.details.employee_id),
    'unknown employee rejected'
  );
});

test('changing employee salary does not change historical payments', () => {
  const before = paymentService
    .list({ employee_id: ali.id })
    .items.map((p) => ({ id: p.id, amount: p.amount, tx: p.transaction_id }));

  employeeService.update(ali.id, {
    name: 'Ali',
    phone: '0300-1234567',
    role: 'Milker',
    joining_date: addDays(today, -90),
    status: 'active',
    pay_type: 'monthly',
    salary: 45000
  });

  const after = paymentService.list({ employee_id: ali.id }).items;
  assert.deepEqual(
    after.map((p) => ({ id: p.id, amount: p.amount, tx: p.transaction_id })),
    before,
    'payment history is untouched by a salary change'
  );

  for (const p of before) {
    const tx = db.prepare('SELECT amount FROM transactions WHERE id = ?').get(p.tx);
    assert.equal(tx.amount, p.amount, 'linked expense is untouched by a salary change');
  }

  assert.equal(employeeService.get(ali.id).salary, 45000, 'current salary is updated for future payments');
});

test('inactive employees remain in historical records', () => {
  const finalPayment = paymentService.create({
    employee_id: bilal.id,
    date: today,
    type: 'salary',
    amount: 35000,
    description: 'Final settlement'
  });
  assert.ok(finalPayment.transaction_id, 'payments can still be recorded for an inactive employee');

  const history = paymentService.list({ employee_id: bilal.id });
  assert.equal(history.total, 1);
  assert.equal(history.items[0].employee_name, 'Bilal');
  assert.equal(history.items[0].employee_status, 'inactive', 'status visible in history');

  const profile = employeeService.profile(bilal.id);
  assert.equal(profile.finance.total_paid, 35000);
  assert.equal(profile.recent_payments.length, 1);

  assert.ok(
    !employeeService.list({ status: 'active' }).some((e) => e.id === bilal.id),
    'inactive employee still excluded from active selections'
  );
});

test('employee deletion is blocked when payments exist, allowed otherwise', () => {
  assert.throws(
    () => employeeService.remove(ali.id),
    (err) => err.status === 409,
    'employee with payment history cannot be deleted'
  );

  const temp = employeeService.create({ name: 'Temporary Worker', pay_type: 'daily', salary: 1000 });
  const result = employeeService.remove(temp.id);
  assert.equal(result.ok, true);
  assert.throws(() => employeeService.get(temp.id), (err) => err.status === 404);
});

test('manually deleting the linked transaction lets an edit recreate the expense', () => {
  const fresh = paymentService.create({ employee_id: ahmed.id, date: today, type: 'other', amount: 500 });

  db.prepare('DELETE FROM transactions WHERE id = ?').run(fresh.transaction_id);
  assert.equal(paymentService.get(fresh.id).transaction_id, null, 'FK sets the link to null');

  const recreated = paymentService.update(fresh.id, {
    employee_id: ahmed.id,
    date: today,
    type: 'other',
    amount: 600
  });
  assert.ok(recreated.transaction_id, 'a new expense is created on edit');
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(recreated.transaction_id);
  assert.equal(tx.amount, 600);
  assert.equal(tx.category, 'labor');
});

test('finance labor totals match employee payments and dashboard', () => {
  const paymentsTotal = paymentService
    .list({ limit: 200 })
    .items.reduce((sum, p) => sum + p.amount, 0);

  const laborAllTime = financeService.totals({ category: 'labor' });
  assertClose(laborAllTime.expenses, paymentsTotal, 'every labor expense comes from an employee payment');
  assert.equal(laborAllTime.net, laborAllTime.income - laborAllTime.expenses, 'net identity holds');

  const dashboard = dashboardService.get();
  const monthStart = startOfMonth(today);
  const monthLabor = financeService.totals({ from: monthStart, to: today, category: 'labor' }).expenses;

  assertClose(dashboard.metrics.employees.labor_cost_this_month, monthLabor, 'dashboard labor cost matches finance');
  assert.equal(
    dashboard.metrics.employees.active_count,
    employeeService.summary().active_count,
    'dashboard active employee count matches'
  );
});

test('employee profile financial summary is correct', () => {
  const profile = employeeService.profile(ali.id);
  const expectedThisMonth = addDays(today, -1).slice(0, 7) === today.slice(0, 7) ? 35000 : 0;

  assert.equal(profile.finance.payments_count, 1, 'advance was deleted earlier');
  assert.equal(profile.finance.total_paid, 35000);
  assert.equal(profile.finance.this_month_paid, expectedThisMonth);
  assert.equal(profile.finance.total_advances, 0);
  assert.equal(profile.finance.outstanding_advances, 0);
  assert.equal(profile.employee.salary, 45000, 'profile shows the current salary');
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
});

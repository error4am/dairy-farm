const os = require('os');
const path = require('path');
const fs = require('fs');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-hardening-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(os.tmpdir(), `dairy-hardening-backups-${process.pid}-${Date.now()}`);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../index');
const db = require('../db/connection');

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

test('impossible calendar dates are rejected on every date field', async () => {
  const animal = await req('POST', '/animals', { tag_number: 'V-1', type: 'cow', gender: 'female' });
  assert.equal(animal.status, 201);
  const animalId = animal.data.id;

  const cases = [
    ['animal date_of_birth', '/animals', { tag_number: 'V-2', type: 'cow', gender: 'female', date_of_birth: '2026-02-30' }, 'date_of_birth'],
    ['animal purchase_date', '/animals', { tag_number: 'V-2b', type: 'cow', gender: 'female', purchase_date: '2026-04-31' }, 'purchase_date'],
    ['milk date', '/milk-records', { animal_id: animalId, date: '2026-04-31', session: 'morning', quantity: 5, unit: 'L' }, 'date'],
    ['transaction date', '/transactions', { date: '2026-02-30', type: 'income', category: 'milk_sale', amount: 10 }, 'date'],
    ['health date', '/health-records', { animal_id: animalId, date: '2026-02-30', type: 'checkup' }, 'date'],
    [
      'health withdrawal_until',
      '/health-records',
      { animal_id: animalId, date: '2026-01-10', type: 'treatment', withdrawal_until: '2026-02-30' },
      'withdrawal_until'
    ],
    ['breeding heat_date', '/breeding-records', { animal_id: animalId, heat_date: '2026-02-30' }, 'heat_date'],
    ['employee joining_date', '/employees', { name: 'V', pay_type: 'monthly', salary: 1, joining_date: '2026-02-30' }, 'joining_date'],
    ['payment date', '/employee-payments', { employee_id: 1, date: '2026-02-30', type: 'salary', amount: 1 }, 'date'],
    ['milk sale date', '/milk-sales', { date: '2026-02-30', litres: 5 }, 'date'],
    ['milk price date', '/milk-prices', { price_per_litre: 100, effective_date: '2026-02-30' }, 'effective_date']
  ];

  for (const [label, urlPath, body, field] of cases) {
    const res = await req('POST', urlPath, body);
    assert.equal(res.status, 400, `${label} should be rejected`);
    assert.ok(res.data.details && res.data.details[field], `${label} should report a ${field} error`);
  }

  const milk = await req('GET', '/milk-records');
  assert.equal(milk.data.total, 0, 'no milk record created from an impossible date');
  const transactions = await req('GET', '/transactions');
  assert.equal(transactions.data.total, 0, 'no transaction created from an impossible date');
  const health = await req('GET', '/health-records');
  assert.equal(health.data.total, 0, 'no health record created from an impossible date');
});

test('valid dates including a leap day are still accepted', async () => {
  const animal = await req('POST', '/animals', {
    tag_number: 'V-3',
    type: 'cow',
    gender: 'female',
    date_of_birth: '2024-02-29'
  });
  assert.equal(animal.status, 201);

  const milk = await req('POST', '/milk-records', {
    animal_id: animal.data.id,
    date: '2024-02-29',
    session: 'morning',
    quantity: 5,
    unit: 'L'
  });
  assert.equal(milk.status, 201);
});

test('oversized request bodies return 413 instead of 500', async () => {
  const res = await req('POST', '/animals', {
    tag_number: 'V-4',
    type: 'cow',
    gender: 'female',
    notes: 'x'.repeat(200000)
  });
  assert.equal(res.status, 413);
  assert.match(res.data.error, /too large/i);
});

test('malformed JSON returns a clear 400', async () => {
  const res = await fetch(base + '/animals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not valid json'
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /invalid request body/i);
});

test('transaction-link indexes exist for linked lookups', () => {
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((row) => row.name);
  assert.ok(names.includes('idx_health_transaction'), 'health_records.transaction_id index exists');
  assert.ok(names.includes('idx_emp_pay_transaction'), 'employee_payments.transaction_id index exists');
  assert.ok(names.includes('idx_milk_sales_transaction'), 'milk_sales.transaction_id index exists');
});

test('non-numeric filters never produce server errors', async () => {
  const paths = [
    '/milk-records?animal_id=abc',
    '/milk-records/summary?animal_id=abc',
    '/transactions?animal_id=abc',
    '/transactions/summary?animal_id=abc',
    '/health-records?animal_id=abc',
    '/breeding-records?animal_id=abc',
    '/employee-payments?employee_id=abc'
  ];
  for (const urlPath of paths) {
    const res = await req('GET', urlPath);
    assert.ok(res.status < 500, `${urlPath} returned ${res.status}`);
  }
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
  fs.rmSync(process.env.BACKUP_DIR, { recursive: true, force: true });
});

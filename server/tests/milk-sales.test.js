const os = require('os');
const path = require('path');
const fs = require('fs');
const { once } = require('node:events');

const dbPath = path.join(os.tmpdir(), `dairy-milk-sales-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const app = require('../index');
const db = require('../db/connection');
const animalService = require('../services/animalService');
const milkService = require('../services/milkService');
const priceService = require('../services/milkPriceService');
const saleService = require('../services/milkSaleService');
const financeService = require('../services/financeService');
const dashboardService = require('../services/dashboardService');
const { todayLocal, addDays } = require('../utils/date');

const EPS = 1e-9;
function assertClose(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPS, `${message} (expected ${expected}, got ${actual})`);
}

const today = todayLocal();
const D_OLD = addDays(today, -20);
const D_PRICE1 = addDays(today, -10);
const D_PRICE2 = addDays(today, -5);

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

function countRows(sql, params = []) {
  return db.prepare(sql).get(...params).n;
}

test('start server on an ephemeral port', async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test('price history CRUD, validation and ordering', async () => {
  const p1 = await priceService.create({ price_per_litre: 220, effective_date: D_PRICE1 });
  assert.equal(p1.price_per_litre, 220);
  assert.equal(p1.effective_date, D_PRICE1);

  const p2 = await priceService.create({ price_per_litre: 230, effective_date: D_PRICE2 });
  assert.equal(p2.price_per_litre, 230);

  await assert.rejects(
    () => priceService.create({ price_per_litre: 250, effective_date: D_PRICE2 }),
    (err) => err.status === 409 && /already exists/i.test(err.message),
    'duplicate effective dates are rejected'
  );

  for (const bad of [
    { price_per_litre: 0, effective_date: today },
    { price_per_litre: -5, effective_date: today },
    { effective_date: today },
    { price_per_litre: 200 },
    { price_per_litre: 200, effective_date: '2026-02-30' }
  ]) {
    await assert.rejects(
      () => priceService.create(bad),
      (err) => err.status === 400,
      `invalid price input rejected: ${JSON.stringify(bad)}`
    );
  }

  const history = await priceService.list({});
  assert.equal(history.length, 2, 'two prices exist');
  assert.ok(
    history[0].effective_date >= history[1].effective_date,
    'history is ordered by effective date descending'
  );

  const edited = await priceService.update(p1.id, { price_per_litre: 240, effective_date: D_PRICE1 });
  assert.equal(edited.price_per_litre, 240);
  await assert.rejects(
    () => priceService.update(p1.id, { price_per_litre: 250, effective_date: D_PRICE2 }),
    (err) => err.status === 409,
    'updating onto an existing effective date is rejected'
  );
  await priceService.update(p1.id, { price_per_litre: 220, effective_date: D_PRICE1 });

  await assert.rejects(
    () => priceService.create({ price_per_litre: 1, effective_date: '2026-02-30' }),
    (err) => err.status === 400 && Boolean(err.details && err.details.effective_date),
    'impossible calendar date is rejected with a field error'
  );

  assert.equal(await priceService.resolve(D_OLD), null, 'no price before the first effective date');
  assert.equal(await priceService.resolve(D_PRICE1), 220, 'first applicable price wins');
  assert.equal(await priceService.resolve(addDays(D_PRICE1, 2)), 220, 'price holds until the next one');
  assert.equal(await priceService.resolve(D_PRICE2), 230, 'latest effective price on the boundary');
  assert.equal(await priceService.resolve(today), 230, 'today uses the latest past price');

  const applicable = await priceService.applicable({ date: D_PRICE1 });
  assert.deepEqual(applicable, { date: D_PRICE1, price_per_litre: 220 });
});

test('sales resolve the historical price for their date and revenue is computed server-side', async () => {
  const s1 = await saleService.create({ date: D_PRICE1, litres: 380 });
  assert.equal(s1.price_per_litre, 220, 'sale on the first price date uses 220');
  assertClose(s1.revenue, 83600, 'revenue is litres times price');
  assert.ok(s1.transaction_id, 'sale is linked to a finance transaction');

  const s2 = await saleService.create({ date: D_PRICE2, litres: 100 });
  assert.equal(s2.price_per_litre, 230, 'sale on the later price date uses 230');
  assertClose(s2.revenue, 23000, 'later sale revenue');

  const tampered = await saleService.create({ date: D_PRICE1, litres: 10, price_per_litre: 999 });
  assert.equal(tampered.price_per_litre, 220, 'the server ignores a client-supplied price');
  assertClose(tampered.revenue, 2200, 'revenue still comes from the price history');
  await saleService.remove(tampered.id);

  await assert.rejects(
    () => saleService.create({ date: D_PRICE1, litres: 10, price_per_litre: 0 }),
    (err) => err.status === 400 && Boolean(err.details && err.details.price_per_litre),
    'zero price on a sale is rejected'
  );
  await assert.rejects(
    () => saleService.create({ date: D_PRICE1, litres: 10, price_per_litre: -1 }),
    (err) => err.status === 400 && Boolean(err.details && err.details.price_per_litre),
    'negative price on a sale is rejected'
  );
  await assert.rejects(
    () => saleService.create({ date: D_PRICE1, litres: 0 }),
    (err) => err.status === 400 && Boolean(err.details && err.details.litres),
    'zero litres are rejected'
  );
  await assert.rejects(
    () => saleService.create({ date: D_PRICE1, litres: -20 }),
    (err) => err.status === 400 && Boolean(err.details && err.details.litres),
    'negative litres are rejected'
  );
  await assert.rejects(
    () => saleService.create({ date: '2026-02-30', litres: 10 }),
    (err) => err.status === 400 && Boolean(err.details && err.details.date),
    'impossible calendar date is rejected'
  );
  await assert.rejects(
    () => saleService.create({ date: D_OLD, litres: 10 }),
    (err) => Boolean(err.status === 400 && err.details && err.details.date && /price/i.test(err.details.date)),
    'a sale without any applicable price is rejected'
  );

  const totalSales = countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_sales');
  assert.equal(totalSales, 2, 'only the two valid sales exist');
});

test('each sale creates exactly one linked milk-sale income transaction', async () => {
  const sales = await saleService.list({});
  assert.equal(sales.total, 2);

  for (const sale of sales.items) {
    assert.ok(sale.transaction_id, 'every sale carries a transaction id');
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(sale.transaction_id);
    assert.ok(tx, 'linked transaction exists');
    assert.equal(tx.type, 'income');
    assert.equal(tx.category, 'milk_sale');
    assert.equal(tx.date, sale.date, 'transaction date follows the sale');
    assertClose(tx.amount, sale.revenue, 'transaction amount equals the sale revenue');
    assert.match(tx.description, /Milk sale:/, 'description identifies the source');
  }

  const incomeTxCount = countRows(
    "SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions WHERE type = 'income' AND category = 'milk_sale'"
  );
  assert.equal(incomeTxCount, 2, 'one income transaction per sale, no duplicates');

  const totals = await financeService.totals();
  const expectedIncome = sales.items.reduce((sum, s) => sum + s.revenue, 0);
  assertClose(totals.income, expectedIncome, 'finance income equals the sum of sale revenues');

  const financeList = await financeService.list({ limit: 50 });
  for (const sale of sales.items) {
    const linked = financeList.items.find((t) => t.id === sale.transaction_id);
    assert.ok(linked, 'linked income appears in the finance list');
    assert.equal(linked.milk_sale_id, sale.id, 'finance list exposes the milk sale link');
  }

  const first = sales.items[0];
  await assert.rejects(
    () =>
      financeService.update(first.transaction_id, {
        date: first.date,
        type: 'income',
        category: 'milk_sale',
        amount: 1,
        description: 'Direct finance edit'
      }),
    (err) => err.status === 409 && /milk sale/i.test(err.message),
    'direct finance edit of a linked sale income is rejected'
  );
  await assert.rejects(
    () => financeService.remove(first.transaction_id),
    (err) => err.status === 409 && /milk sale/i.test(err.message),
    'direct finance delete of a linked sale income is rejected'
  );
});

test('editing a sale updates the same transaction without duplicating it', async () => {
  const sale = (await saleService.list({})).items.find((s) => s.litres === 380);
  assert.ok(sale, 'the 380 L sale exists');
  const txCountBefore = countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions');
  const revenueBefore = (await financeService.totals()).income;

  const sameDate = await saleService.update(sale.id, { date: sale.date, litres: 360 });
  assert.equal(sameDate.transaction_id, sale.transaction_id, 'same transaction is reused');
  assert.equal(sameDate.price_per_litre, 220, 'editing litres keeps the stored historical price');
  assertClose(sameDate.revenue, 79200, 'revenue recalculated with the stored price');
  assert.equal(
    countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions'),
    txCountBefore,
    'no extra transaction was created'
  );

  let tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(sameDate.transaction_id);
  assertClose(tx.amount, 79200, 'linked transaction amount follows the edit');
  assertClose(
    (await financeService.totals()).income,
    revenueBefore - 83600 + 79200,
    'finance income follows the sale edit'
  );

  const moved = await saleService.update(sale.id, { date: D_PRICE2, litres: 360 });
  assert.equal(moved.transaction_id, sale.transaction_id, 'moving the sale keeps the transaction');
  assert.equal(moved.price_per_litre, 230, "a new date picks that date's price");
  assertClose(moved.revenue, 82800, "revenue uses the new date's price");
  tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(moved.transaction_id);
  assert.equal(tx.date, D_PRICE2, 'transaction date follows the moved sale');
  assertClose(tx.amount, 82800, 'transaction amount follows the moved sale');

  const movedBack = await saleService.update(sale.id, { date: D_PRICE1, litres: 360 });
  assert.equal(movedBack.price_per_litre, 220, 'moving back resolves the original price again');
  assertClose(movedBack.revenue, 79200, 'revenue restored for the original date');
  assert.equal(
    countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions'),
    txCountBefore,
    'still exactly one transaction after all edits'
  );
});

test('changing a price never rewrites historical sales', async () => {
  const price1 = (await priceService.list({})).find((p) => p.effective_date === D_PRICE1);
  await priceService.update(price1.id, { price_per_litre: 260, effective_date: D_PRICE1 });

  const sales = await saleService.list({});
  const oldSale = sales.items.find((s) => s.date === D_PRICE1);
  const laterSale = sales.items.find((s) => s.date === D_PRICE2);

  assert.equal(oldSale.price_per_litre, 220, 'stored price on the sale row is untouched');
  assertClose(oldSale.revenue, 79200, 'historical revenue is unchanged');
  assertClose(
    db.prepare('SELECT amount FROM transactions WHERE id = ?').get(oldSale.transaction_id).amount,
    79200,
    'linked income is unchanged'
  );
  assert.equal(laterSale.price_per_litre, 230, 'other sales keep their own stored prices');

  const fresh = await saleService.create({ date: D_PRICE1, litres: 10 });
  assert.equal(fresh.price_per_litre, 260, 'new sales use the updated price');
  assertClose(fresh.revenue, 2600, 'new sale revenue uses the updated price');

  const income = (await financeService.totals()).income;
  assertClose(income, 79200 + 23000 + 2600, 'finance income is the sum of stored revenues');
});

test('deleting a sale removes its linked income and leaves no orphans', async () => {
  const sales = await saleService.list({});
  const disposable = sales.items.find((s) => s.litres === 10);
  assert.ok(disposable, 'the disposable sale exists');

  const incomeBefore = (await financeService.totals()).income;
  const result = await saleService.remove(disposable.id);
  assert.equal(result.ok, true);

  assert.equal(
    countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_sales WHERE id = ?', [disposable.id]),
    0,
    'sale row removed'
  );
  assert.equal(
    countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions WHERE id = ?', [
      disposable.transaction_id
    ]),
    0,
    'linked income removed with it'
  );
  assertClose((await financeService.totals()).income, incomeBefore - 2600, 'income returns to the prior total');

  await assert.rejects(
    () => saleService.remove(disposable.id),
    (err) => err.status === 404,
    'deleting twice reports not found'
  );
});

test('milk production and milk sales stay separate, and remaining equals produced minus sold', async () => {
  const animal = await animalService.create({ tag_number: 'SALE-1', type: 'cow', gender: 'female' });

  const salesBefore = (await saleService.list({})).total;
  const incomeBefore = (await financeService.totals()).income;

  await milkService.create({ animal_id: animal.id, date: D_PRICE1, session: 'morning', quantity: 400, unit: 'L' });
  await milkService.create({ animal_id: animal.id, date: D_PRICE2, session: 'evening', quantity: 200, unit: 'L' });

  assert.equal(
    (await saleService.list({})).total,
    salesBefore,
    'recording production never creates sales'
  );
  assertClose((await financeService.totals()).income, incomeBefore, 'recording production never creates income');
  assert.equal(
    countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_records WHERE animal_id = ?', [animal.id]),
    2,
    'both production records exist'
  );

  const salesBeforeCreate = (await saleService.list({})).total;
  await saleService.remove((await saleService.list({})).items[0].id);
  assert.equal(
    countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_records'),
    2,
    'deleting a sale never touches production records'
  );
  const restored = await saleService.create({ date: D_PRICE2, litres: 100 });
  assert.equal((await saleService.list({})).total, salesBeforeCreate, 'sales count is independent of production');

  const rangeSales = await saleService.list({ from: D_PRICE1, to: D_PRICE2 });
  const summary = await saleService.summary({ from: D_PRICE1, to: D_PRICE2 });
  const soldExpected = rangeSales.items.reduce((sum, s) => sum + s.litres, 0);

  assertClose(summary.range.produced, 600, 'produced comes from milk records only');
  assertClose(summary.range.sold, soldExpected, 'sold comes from sales only');
  assertClose(summary.range.remaining, 600 - soldExpected, 'remaining is produced minus sold');
  assert.equal(summary.range.sales_count, rangeSales.total, 'range sales count matches');
  assertClose(
    summary.range.revenue,
    rangeSales.items.reduce((sum, s) => sum + s.revenue, 0),
    'range revenue matches the sales'
  );
  assert.equal(summary.current_price, await priceService.resolve(today), 'current price is the applicable price');
  assert.equal(summary.unit, 'L', 'unit comes from farm settings');
  assert.equal(restored.litres, 100, 'the re-created sale is present');
});

test('dashboard milk sales metrics match the sales summary', async () => {
  const dash = await dashboardService.get();
  const summary = await saleService.summary({});
  const monthStart = today.slice(0, 7) + '-01';

  const todayRow = db
    .prepare(
      'SELECT COALESCE(SUM(litres), 0) AS litres, COALESCE(SUM(revenue), 0) AS revenue FROM milk_sales WHERE date = ?'
    )
    .get(today);
  const monthRow = db
    .prepare(
      'SELECT COALESCE(SUM(litres), 0) AS litres, COALESCE(SUM(revenue), 0) AS revenue FROM milk_sales WHERE date >= ? AND date <= ?'
    )
    .get(monthStart, today);

  assertClose(dash.metrics.milk_sales.sold_today, todayRow.litres, 'dashboard sold today');
  assertClose(dash.metrics.milk_sales.revenue_today, todayRow.revenue, 'dashboard revenue today');
  assertClose(dash.metrics.milk_sales.sold_month, monthRow.litres, 'dashboard sold this month');
  assertClose(dash.metrics.milk_sales.revenue_month, monthRow.revenue, 'dashboard revenue this month');
  assertClose(summary.today.sold, dash.metrics.milk_sales.sold_today, 'summary and dashboard agree on today');
  assertClose(summary.month.sold, dash.metrics.milk_sales.sold_month, 'summary and dashboard agree on the month');
});

test('sale listing supports filters, search and pagination', async () => {
  const all = await saleService.list({ limit: 50 });
  assert.ok(all.total >= 2);

  const onlyFirstDay = await saleService.list({ from: D_PRICE1, to: D_PRICE1 });
  assert.equal(onlyFirstDay.total, 1, 'range filter narrows to one day');
  assert.equal(onlyFirstDay.items[0].date, D_PRICE1);

  const target = all.items.find((s) => s.date === D_PRICE2);
  await saleService.update(target.id, { date: target.date, litres: target.litres, notes: 'Bulk buyer A' });
  const searched = await saleService.list({ search: 'bulk' });
  assert.equal(searched.total, 1, 'search matches sale notes');
  assert.equal(searched.items[0].id, target.id);

  const paged = await saleService.list({ limit: 1 });
  assert.equal(paged.items.length, 1, 'limit is respected');
  assert.equal(paged.total, all.total, 'total covers every row');
  assert.equal(paged.limit, 1);
});

test('a manually deleted linked income is recreated on the next sale edit', async () => {
  const sale = (await saleService.list({})).items.find((s) => s.date === D_PRICE1);
  assert.ok(sale, 'a sale on the first price date exists');
  const originalTxId = sale.transaction_id;

  db.prepare('DELETE FROM transactions WHERE id = ?').run(originalTxId);

  const updated = await saleService.update(sale.id, { date: sale.date, litres: 350 });
  assert.ok(updated.transaction_id, 'the missing income was recreated');
  assert.notEqual(updated.transaction_id, originalTxId, 'a new transaction id is issued');
  assertClose(updated.revenue, 350 * 220, 'recreated revenue matches the stored price');
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(updated.transaction_id);
  assert.ok(tx, 'the recreated transaction exists');
  assert.equal(tx.type, 'income');
  assert.equal(tx.category, 'milk_sale');
  assertClose(tx.amount, updated.revenue, 'recreated amount matches');
  assert.equal(updated.notes, sale.notes, 'notes survive the edit');

  await saleService.remove(updated.id);
  assert.equal(
    countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions WHERE id = ?', [updated.transaction_id]),
    0,
    'deleting the sale removes the recreated income too'
  );
});

test('HTTP routes validate input and drive the full sale lifecycle', async () => {
  const badPrice = await req('POST', '/milk-prices', { price_per_litre: 0, effective_date: today });
  assert.equal(badPrice.status, 400, 'zero price rejected over HTTP');
  assert.ok(badPrice.data.details.price_per_litre);

  const dupPrice = await req('POST', '/milk-prices', { price_per_litre: 150, effective_date: D_PRICE2 });
  assert.equal(dupPrice.status, 409, 'duplicate price date rejected over HTTP');

  const newPrice = await req('POST', '/milk-prices', { price_per_litre: 150, effective_date: D_OLD });
  assert.equal(newPrice.status, 201, 'a valid price is created');
  assert.equal(newPrice.data.price_per_litre, 150);

  const badDate = await req('POST', '/milk-prices', { price_per_litre: 180, effective_date: '2026-02-30' });
  assert.equal(badDate.status, 400, 'impossible date rejected over HTTP');
  assert.ok(badDate.data.details.effective_date);

  const applicable = await req('GET', `/milk-prices/applicable?date=${D_PRICE1}`);
  assert.equal(applicable.status, 200);
  assert.deepEqual(applicable.data, { date: D_PRICE1, price_per_litre: 260 });

  const noPrice = await req('POST', '/milk-sales', { date: addDays(D_OLD, -30), litres: 10 });
  assert.equal(noPrice.status, 400, 'sale without a price for its date is rejected');

  const zeroLitres = await req('POST', '/milk-sales', { date: today, litres: 0 });
  assert.equal(zeroLitres.status, 400, 'zero litres rejected over HTTP');
  assert.ok(zeroLitres.data.details.litres);

  const badSaleDate = await req('POST', '/milk-sales', { date: '2026-02-30', litres: 5 });
  assert.equal(badSaleDate.status, 400, 'impossible sale date rejected over HTTP');
  assert.ok(badSaleDate.data.details.date);

  const saleRes = await req('POST', '/milk-sales', { date: today, litres: 50, notes: 'HTTP sale' });
  assert.equal(saleRes.status, 201, 'a valid sale is created');
  assert.equal(saleRes.data.price_per_litre, 230, 'sale uses the price applicable today');
  assertClose(saleRes.data.revenue, 11500, 'revenue computed server-side');
  assert.ok(saleRes.data.transaction_id, 'sale is linked to a transaction');

  const summaryRes = await req('GET', '/milk-sales/summary');
  assert.equal(summaryRes.status, 200);
  assert.ok(summaryRes.data.range);
  assert.ok(summaryRes.data.today);

  const listRes = await req('GET', '/milk-sales?limit=50');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.data.items.find((s) => s.id === saleRes.data.id).notes, 'HTTP sale');

  const financeRes = await req('GET', '/transactions?limit=100');
  assert.equal(financeRes.status, 200);
  const linked = financeRes.data.items.find((t) => t.milk_sale_id === saleRes.data.id);
  assert.ok(linked, 'finance list exposes the milk sale link');
  assert.equal(linked.category, 'milk_sale');

  const editFinance = await req('PUT', `/transactions/${saleRes.data.transaction_id}`, {
    date: today,
    type: 'income',
    category: 'milk_sale',
    amount: 1,
    description: 'Tampered'
  });
  assert.equal(editFinance.status, 409, 'direct finance edit rejected with 409');
  assert.match(editFinance.data.error, /milk sale/i);

  const deleteFinance = await req('DELETE', `/transactions/${saleRes.data.transaction_id}`);
  assert.equal(deleteFinance.status, 409, 'direct finance delete rejected with 409');
  assert.match(deleteFinance.data.error, /milk sale/i);

  const txIdBefore = saleRes.data.transaction_id;
  const editSale = await req('PUT', `/milk-sales/${saleRes.data.id}`, {
    date: today,
    litres: 60,
    notes: 'HTTP sale edited'
  });
  assert.equal(editSale.status, 200, 'sale edit succeeds');
  assert.equal(editSale.data.transaction_id, txIdBefore, 'edit reuses the same transaction');
  assertClose(editSale.data.revenue, 13800, 'edited revenue recalculated');

  const deleteSale = await req('DELETE', `/milk-sales/${saleRes.data.id}`);
  assert.equal(deleteSale.status, 200, 'sale deletion succeeds');
  assert.equal(
    countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions WHERE id = ?', [txIdBefore]),
    0,
    'linked income deleted with the sale over HTTP'
  );

  const missing = await req('GET', '/milk-sales/999999');
  assert.equal(missing.status, 404, 'unknown sale reports not found');
});

test('final integrity: no orphan sales, no unlinked milk incomes, no duplicate links', async () => {
  const orphanSales = countRows(
    'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_sales s LEFT JOIN transactions t ON t.id = s.transaction_id WHERE s.transaction_id IS NOT NULL AND t.id IS NULL'
  );
  assert.equal(orphanSales, 0, 'every linked sale points at an existing transaction');

  const orphanIncomes = countRows(
    "SELECT CAST(COUNT(*) AS INTEGER) AS n FROM transactions t LEFT JOIN milk_sales s ON s.transaction_id = t.id WHERE t.type = 'income' AND t.category = 'milk_sale' AND s.id IS NULL"
  );
  assert.equal(orphanIncomes, 0, 'every milk-sale income belongs to exactly one sale');

  const duplicateLinks = countRows(
    "SELECT CAST(COUNT(*) AS INTEGER) AS n FROM (SELECT transaction_id FROM milk_sales WHERE transaction_id IS NOT NULL GROUP BY transaction_id HAVING COUNT(*) > 1)"
  );
  assert.equal(duplicateLinks, 0, 'no transaction is shared by two sales');

  const wrongTotals = countRows(
    `SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_sales s
     JOIN transactions t ON t.id = s.transaction_id
     WHERE ABS(t.amount - s.revenue) > 0.001 OR t.type <> 'income' OR t.category <> 'milk_sale' OR t.date <> s.date`
  );
  assert.equal(wrongTotals, 0, 'every linked transaction mirrors its sale');

  const pricesOk = countRows('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_prices WHERE price_per_litre <= 0');
  assert.equal(pricesOk, 0, 'no zero or negative prices are stored');
  const salesBad = countRows(
    'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM milk_sales WHERE litres <= 0 OR price_per_litre <= 0 OR revenue < 0'
  );
  assert.equal(salesBad, 0, 'no invalid sale rows are stored');
});

after(async () => {
  if (server) {
    server.close();
    await once(server, 'close').catch(() => {});
  }
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

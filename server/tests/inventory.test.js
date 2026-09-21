const os = require('os');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(os.tmpdir(), `dairy-inventory-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(os.tmpdir(), `dairy-inventory-backups-${process.pid}`);

const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');

require('../db/seed')();

const db = require('../db/connection');
const inventoryService = require('../services/inventoryService');
const movementService = require('../services/inventoryMovementService');
const financeService = require('../services/financeService');
const dashboardService = require('../services/dashboardService');
const { todayLocal, addDays } = require('../utils/date');

const today = todayLocal();

let silage;

before(async () => {
  silage = await inventoryService.create({
    name: 'Wanda Silage',
    category: 'silage',
    unit: 'kg',
    minimum_stock: 2000,
    notes: 'Main silage store'
  });
});

async function expectFieldError(fn, field, message) {
  await assert.rejects(fn, (err) => err.status === 400 && Boolean(err.details && err.details[field]), message);
}

async function expectStatus(fn, status, message) {
  await assert.rejects(fn, (err) => err.status === status, message);
}

test('creates inventory items and enforces unique names', async () => {
  assert.equal(silage.name, 'Wanda Silage');
  assert.equal(silage.category, 'silage');
  assert.equal(silage.unit, 'kg');
  assert.equal(silage.active, 1);
  assert.equal(silage.current_stock, 0);
  assert.equal(silage.minimum_stock, 2000);

  await assert.rejects(
    () => inventoryService.create({ name: 'Wanda Silage', category: 'silage', unit: 'kg' }),
    (err) => err.status === 409,
    'duplicate item name rejected'
  );
});

test('rejects invalid item input', async () => {
  await expectFieldError(() => inventoryService.create({ category: 'silage', unit: 'kg' }), 'name', 'name required');
  await expectFieldError(() => inventoryService.create({ name: 'X1', category: 'gold', unit: 'kg' }), 'category', 'category enum');
  await expectFieldError(() => inventoryService.create({ name: 'X2', category: 'silage' }), 'unit', 'unit required');
  await expectFieldError(
    () => inventoryService.create({ name: 'X3', category: 'silage', unit: 'kg', minimum_stock: -5 }),
    'minimum_stock',
    'negative minimum rejected'
  );
  await expectFieldError(
    () => inventoryService.create({ name: 'X4', category: 'silage', unit: '21000' }),
    'unit',
    'numeric unit rejected'
  );
  await expectFieldError(
    () => inventoryService.create({ name: 'X5', category: 'silage', unit: 'kg2332' }),
    'unit',
    'alphanumeric unit rejected'
  );
});

test('edits and deactivates items', async () => {
  const updated = await inventoryService.update(silage.id, {
    name: 'Wanda Silage',
    category: 'silage',
    unit: 'kg',
    minimum_stock: 2500,
    active: true,
    notes: 'Updated'
  });
  assert.equal(updated.minimum_stock, 2500);
  assert.equal(updated.notes, 'Updated');

  const inactive = await inventoryService.update(silage.id, {
    name: 'Wanda Silage',
    category: 'silage',
    unit: 'kg',
    minimum_stock: 2500,
    active: false
  });
  assert.equal(inactive.active, 0);

  const reactivated = await inventoryService.update(silage.id, {
    name: 'Wanda Silage',
    category: 'silage',
    unit: 'kg',
    minimum_stock: 2500,
    active: true
  });
  assert.equal(reactivated.active, 1);
});

test('records the full movement lifecycle and derives current stock', async () => {
  const opening = await movementService.create({
    item_id: silage.id,
    date: addDays(today, -30),
    type: 'opening',
    quantity: 10000,
    unit: 'kg'
  });
  assert.equal(opening.quantity, 10000);

  const purchase = await movementService.create({
    item_id: silage.id,
    date: addDays(today, -20),
    type: 'purchase',
    quantity: 5000,
    unit: 'kg',
    unit_cost: 50,
    total_cost: 250000,
    supplier: 'Feed Co'
  });
  assert.equal(purchase.quantity, 5000);
  assert.equal(purchase.total_cost, 250000);

  const consumption = await movementService.create({
    item_id: silage.id,
    date: addDays(today, -10),
    type: 'consumption',
    quantity: 1200,
    unit: 'kg'
  });
  assert.equal(consumption.quantity, -1200, 'consumption stored as a negative movement');

  const waste = await movementService.create({
    item_id: silage.id,
    date: addDays(today, -5),
    type: 'waste',
    quantity: 200,
    unit: 'kg',
    notes: 'Spoiled'
  });
  assert.equal(waste.quantity, -200);

  const adjustment = await movementService.create({
    item_id: silage.id,
    date: addDays(today, -1),
    type: 'adjustment',
    quantity: 100,
    unit: 'kg',
    direction: 'increase',
    notes: 'Physical count'
  });
  assert.equal(adjustment.quantity, 100);

  const item = await inventoryService.get(silage.id);
  assert.equal(item.current_stock, 13700, '10000 + 5000 - 1200 - 200 + 100');

  const profile = await inventoryService.profile(silage.id);
  assert.equal(profile.stock.opening, 10000);
  assert.equal(profile.stock.purchased, 5000);
  assert.equal(profile.stock.consumed, 1200);
  assert.equal(profile.stock.wasted, 200);
  assert.equal(profile.stock.adjusted, 100);
  assert.equal(profile.stock.current, 13700);
  assert.equal(profile.stock.movements_count, 5);
});

test('supports negative adjustments', async () => {
  const before = (await inventoryService.get(silage.id)).current_stock;

  const adjustment = await movementService.create({
    item_id: silage.id,
    date: today,
    type: 'adjustment',
    quantity: 300,
    unit: 'kg',
    direction: 'decrease',
    notes: 'Count correction'
  });
  assert.equal(adjustment.quantity, -300);
  assert.equal((await inventoryService.get(silage.id)).current_stock, before - 300);
});

test('rejects invalid movement input', async () => {
  await expectFieldError(
    () => movementService.create({ item_id: silage.id, date: today, type: 'consumption', quantity: 0 }),
    'quantity',
    'zero quantity'
  );
  await expectFieldError(
    () => movementService.create({ item_id: silage.id, date: today, type: 'consumption', quantity: -5 }),
    'quantity',
    'negative quantity'
  );
  await expectFieldError(
    () => movementService.create({ item_id: silage.id, date: today, type: 'consumption', quantity: 'abc' }),
    'quantity',
    'non-numeric quantity'
  );
  await expectFieldError(
    () => movementService.create({ item_id: silage.id, date: '2026-02-30', type: 'consumption', quantity: 1 }),
    'date',
    'impossible date'
  );
  await expectFieldError(
    () => movementService.create({ item_id: 999999, date: today, type: 'consumption', quantity: 1 }),
    'item_id',
    'unknown item'
  );
  await expectFieldError(
    () => movementService.create({ item_id: silage.id, date: today, type: 'consumption', quantity: 1, unit: 'bag' }),
    'unit',
    'wrong unit rejected'
  );
  await expectFieldError(
    () => movementService.create({ item_id: silage.id, date: today, type: 'adjustment', quantity: 1 }),
    'notes',
    'adjustment requires a reason'
  );
  await expectFieldError(
    () => movementService.create({ item_id: silage.id, date: today, type: 'consumption', quantity: 1, total_cost: 100 }),
    'total_cost',
    'costs only on purchases'
  );
  await expectFieldError(
    () => movementService.create({ item_id: silage.id, date: today, type: 'consumption', quantity: 1, unit_cost: 10 }),
    'total_cost',
    'unit cost only on purchases'
  );
});

test('blocks movements that would make stock negative', async () => {
  const fodder = await inventoryService.create({ name: 'Turi Fodder', category: 'fodder', unit: 'kg' });
  await movementService.create({ item_id: fodder.id, date: today, type: 'opening', quantity: 100, unit: 'kg' });

  await expectStatus(
    () => movementService.create({ item_id: fodder.id, date: today, type: 'consumption', quantity: 150, unit: 'kg' }),
    400,
    'consumption beyond stock rejected'
  );
  await expectStatus(
    () => movementService.create({ item_id: fodder.id, date: today, type: 'waste', quantity: 150, unit: 'kg' }),
    400,
    'waste beyond stock rejected'
  );
  await expectStatus(
    () =>
      movementService.create({
        item_id: fodder.id,
        date: today,
        type: 'adjustment',
        quantity: 150,
        unit: 'kg',
        direction: 'decrease',
        notes: 'too much'
      }),
    400,
    'negative adjustment beyond stock rejected'
  );

  const consumption = await movementService.create({ item_id: fodder.id, date: today, type: 'consumption', quantity: 40, unit: 'kg' });
  await expectStatus(
    () =>
      movementService.update(consumption.id, {
        item_id: fodder.id,
        date: today,
        type: 'consumption',
        quantity: 150,
        unit: 'kg'
      }),
    400,
    'editing a movement beyond stock rejected'
  );

  const purchase = await movementService.create({ item_id: fodder.id, date: today, type: 'purchase', quantity: 10, unit: 'kg' });
  const purchaseOnly = await inventoryService.create({ name: 'Berseem Green Fodder', category: 'fodder', unit: 'kg' });
  const onlyPurchase = await movementService.create({ item_id: purchaseOnly.id, date: today, type: 'purchase', quantity: 50, unit: 'kg' });
  await movementService.create({ item_id: purchaseOnly.id, date: today, type: 'consumption', quantity: 50, unit: 'kg' });
  await expectStatus(
    () => movementService.remove(onlyPurchase.id),
    400,
    'deleting a purchase that would make stock negative is blocked'
  );

  assert.equal((await inventoryService.get(purchaseOnly.id)).current_stock, 0);
  assert.equal((await inventoryService.get(fodder.id)).current_stock, 70, '100 - 40 + 10');
  assert.ok(purchase.id > 0);
});

test('inactive items only accept adjustments', async () => {
  const supply = await inventoryService.create({ name: 'Mineral Mix', category: 'mineral', unit: 'kg' });
  await movementService.create({ item_id: supply.id, date: today, type: 'opening', quantity: 100, unit: 'kg' });

  await inventoryService.update(supply.id, {
    name: 'Mineral Mix',
    category: 'mineral',
    unit: 'kg',
    active: false
  });

  await expectStatus(
    () => movementService.create({ item_id: supply.id, date: today, type: 'purchase', quantity: 10, unit: 'kg' }),
    400,
    'purchase on inactive item rejected'
  );
  await expectStatus(
    () => movementService.create({ item_id: supply.id, date: today, type: 'consumption', quantity: 10, unit: 'kg' }),
    400,
    'consumption on inactive item rejected'
  );

  const adjustment = await movementService.create({
    item_id: supply.id,
    date: today,
    type: 'adjustment',
    quantity: 5,
    unit: 'kg',
    direction: 'decrease',
    notes: 'correction'
  });
  assert.equal(adjustment.quantity, -5);
});

test('purchase creates exactly one linked finance expense', async () => {
  const concentrate = await inventoryService.create({ name: 'Wanda Concentrate', category: 'concentrate', unit: 'kg' });
  const before = await financeService.totals();

  const purchase = await movementService.create({
    item_id: concentrate.id,
    date: today,
    type: 'purchase',
    quantity: 10,
    unit: 'kg',
    unit_cost: 500,
    total_cost: 5000,
    supplier: 'Feed Co'
  });

  assert.ok(purchase.transaction_id, 'linked transaction id is stored');

  const after = await financeService.totals();
  assert.equal(after.count - before.count, 1, 'exactly one expense created');
  assert.equal(after.expenses - before.expenses, 5000, 'expense amount matches');

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(purchase.transaction_id);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.category, 'feed');
  assert.equal(tx.amount, 5000);
  assert.match(tx.description, /Purchase: Wanda Concentrate/);
  assert.match(tx.description, /Feed Co/);

  const list = await financeService.list({ limit: 10 });
  const row = list.items.find((t) => t.id === purchase.transaction_id);
  assert.equal(row.inventory_item_id, concentrate.id, 'finance list exposes the inventory link');
  assert.equal(row.inventory_movement_id, purchase.id);
});

test('purchase total cost is computed from unit cost when missing', async () => {
  const item = await inventoryService.create({ name: 'Silage Additive', category: 'supply', unit: 'L' });
  const before = await financeService.totals();

  const purchase = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 4,
    unit: 'L',
    unit_cost: 250
  });

  assert.equal(purchase.total_cost, 1000);
  const after = await financeService.totals();
  assert.equal(after.expenses - before.expenses, 1000);

  const free = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 2,
    unit: 'L',
    total_cost: 0
  });
  assert.equal(free.transaction_id, null, 'zero-cost purchase creates no expense');
  assert.equal((await financeService.totals()).count, after.count, 'no extra expense for zero cost');
});

test('editing a purchase updates the linked expense without duplicates', async () => {
  const item = await inventoryService.create({ name: 'Maize Silage', category: 'silage', unit: 'kg' });
  const purchase = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 100,
    unit: 'kg',
    unit_cost: 20,
    total_cost: 2000
  });
  const beforeCount = (await financeService.totals()).count;

  const updated = await movementService.update(purchase.id, {
    item_id: item.id,
    date: addDays(today, -1),
    type: 'purchase',
    quantity: 100,
    unit: 'kg',
    unit_cost: 20,
    total_cost: 2500,
    supplier: 'New Supplier'
  });

  assert.equal(updated.total_cost, 2500);
  assert.equal((await financeService.totals()).count, beforeCount, 'no duplicate expense on edit');

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(updated.transaction_id);
  assert.equal(tx.amount, 2500);
  assert.equal(tx.date, addDays(today, -1));
  assert.match(tx.description, /New Supplier/);
});

test('clearing purchase cost removes the linked expense', async () => {
  const item = await inventoryService.create({ name: 'Cotton Seed Cake', category: 'concentrate', unit: 'kg' });
  const purchase = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 50,
    unit: 'kg',
    unit_cost: 40,
    total_cost: 2000
  });
  const beforeCount = (await financeService.totals()).count;

  const cleared = await movementService.update(purchase.id, {
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 50,
    unit: 'kg'
  });

  assert.equal(cleared.transaction_id, null);
  assert.equal(cleared.total_cost, null);
  assert.equal((await financeService.totals()).count, beforeCount - 1, 'expense removed with the cost');
});

test('deleting a purchase removes its linked expense', async () => {
  const item = await inventoryService.create({ name: 'Wheat Bran', category: 'concentrate', unit: 'kg' });
  const purchase = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 20,
    unit: 'kg',
    unit_cost: 30,
    total_cost: 600
  });
  const txId = purchase.transaction_id;
  const beforeCount = (await financeService.totals()).count;

  const result = await movementService.remove(purchase.id);
  assert.equal(result.ok, true);
  assert.equal((await financeService.totals()).count, beforeCount - 1, 'expense deleted with the purchase');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE id = ?').get(txId).n, 0);
  assert.equal((await inventoryService.get(item.id)).current_stock, 0);
});

test('finance cannot edit or delete linked inventory expenses', async () => {
  const item = await inventoryService.create({ name: 'Urea Treatment Molasses', category: 'supply', unit: 'L' });
  const purchase = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 10,
    unit: 'L',
    total_cost: 1500
  });

  await assert.rejects(
    () =>
      financeService.update(purchase.transaction_id, {
        date: today,
        type: 'expense',
        category: 'feed',
        amount: 1
      }),
    (err) => err.status === 409 && /inventory purchase/i.test(err.message),
    'direct finance edit blocked'
  );
  await assert.rejects(
    () => financeService.remove(purchase.transaction_id),
    (err) => err.status === 409 && /inventory purchase/i.test(err.message),
    'direct finance delete blocked'
  );

  const tx = db.prepare('SELECT amount FROM transactions WHERE id = ?').get(purchase.transaction_id);
  assert.equal(tx.amount, 1500, 'linked expense unchanged');
});

test('manually deleting the linked transaction lets an edit recreate it', async () => {
  const item = await inventoryService.create({ name: 'Salt Lick', category: 'mineral', unit: 'kg' });
  const purchase = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 5,
    unit: 'kg',
    total_cost: 250
  });

  db.prepare('DELETE FROM transactions WHERE id = ?').run(purchase.transaction_id);
  assert.equal((await movementService.get(purchase.id)).transaction_id, null, 'FK sets the link to null');

  const recreated = await movementService.update(purchase.id, {
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 5,
    unit: 'kg',
    total_cost: 300
  });
  assert.ok(recreated.transaction_id, 'a new expense is created on edit');
  const tx = db.prepare('SELECT amount, category FROM transactions WHERE id = ?').get(recreated.transaction_id);
  assert.equal(tx.amount, 300);
  assert.equal(tx.category, 'feed');
});

test('movement listing supports filters, ordering and pagination', async () => {
  const item = await inventoryService.create({ name: 'Filter Test Item', category: 'other', unit: 'kg' });
  await movementService.create({ item_id: item.id, date: addDays(today, -3), type: 'opening', quantity: 100, unit: 'kg' });
  await movementService.create({ item_id: item.id, date: addDays(today, -2), type: 'purchase', quantity: 50, unit: 'kg', supplier: 'FilterSupplier' });
  await movementService.create({ item_id: item.id, date: addDays(today, -1), type: 'consumption', quantity: 10, unit: 'kg' });

  const all = await movementService.list({ item_id: item.id });
  assert.equal(all.total, 3);
  assert.equal(all.items[0].type, 'consumption', 'newest movement first');

  const purchases = await movementService.list({ item_id: item.id, type: 'purchase' });
  assert.equal(purchases.total, 1);

  const ranged = await movementService.list({ item_id: item.id, from: addDays(today, -2), to: addDays(today, -1) });
  assert.equal(ranged.total, 2);

  const searched = await movementService.list({ search: 'FilterSupplier' });
  assert.equal(searched.total, 1);

  const paged = await movementService.list({ item_id: item.id, limit: 2, offset: 0 });
  assert.equal(paged.items.length, 2);
  assert.equal(paged.total, 3);
  const page2 = await movementService.list({ item_id: item.id, limit: 2, offset: 2 });
  assert.equal(page2.items.length, 1);
});

test('low stock and out of stock are derived from movements and thresholds', async () => {
  const low = await inventoryService.create({ name: 'Low Stock Item', category: 'fodder', unit: 'kg', minimum_stock: 100 });
  await movementService.create({ item_id: low.id, date: today, type: 'opening', quantity: 50, unit: 'kg' });

  const healthy = await inventoryService.create({ name: 'Healthy Stock Item', category: 'fodder', unit: 'kg', minimum_stock: 100 });
  await movementService.create({ item_id: healthy.id, date: today, type: 'opening', quantity: 200, unit: 'kg' });

  const empty = await inventoryService.create({ name: 'Empty Stock Item', category: 'fodder', unit: 'kg', minimum_stock: 100 });
  await movementService.create({ item_id: empty.id, date: today, type: 'opening', quantity: 10, unit: 'kg' });
  await movementService.create({ item_id: empty.id, date: today, type: 'consumption', quantity: 10, unit: 'kg' });

  const inactive = await inventoryService.create({ name: 'Inactive Stock Item', category: 'fodder', unit: 'kg', minimum_stock: 100 });
  await inventoryService.update(inactive.id, {
    name: 'Inactive Stock Item',
    category: 'fodder',
    unit: 'kg',
    minimum_stock: 100,
    active: false
  });

  const lowList = await inventoryService.list({ status: 'low' });
  const outList = await inventoryService.list({ status: 'out' });
  const summary = await inventoryService.summary();

  assert.ok(lowList.some((i) => i.id === low.id), 'low stock item listed');
  assert.ok(!lowList.some((i) => i.id === healthy.id), 'healthy item not low');
  assert.ok(outList.some((i) => i.id === empty.id), 'empty item listed as out of stock');
  assert.ok(!outList.some((i) => i.id === inactive.id), 'inactive item excluded');

  assert.equal(summary.low_stock_count, lowList.length);
  assert.equal(summary.out_of_stock_count, outList.length);
  assert.equal(summary.active_count, (await inventoryService.list({ status: 'active' })).length);
});

test('dashboard inventory metrics match the inventory summary', async () => {
  const dashboard = await dashboardService.get();
  const summary = await inventoryService.summary();

  assert.equal(dashboard.metrics.inventory.active_items, summary.active_count);
  assert.equal(dashboard.metrics.inventory.low_stock, summary.low_stock_count);
  assert.equal(dashboard.metrics.inventory.out_of_stock, summary.out_of_stock_count);
});

test('items with movements cannot be deleted; empty items can', async () => {
  const emptyItem = await inventoryService.create({ name: 'Delete Me', category: 'other', unit: 'kg' });
  const result = await inventoryService.remove(emptyItem.id);
  assert.equal(result.ok, true);
  await expectStatus(() => inventoryService.get(emptyItem.id), 404, 'deleted item is gone');

  await assert.rejects(
    () => inventoryService.remove(silage.id),
    (err) => err.status === 409 && /stock movements/i.test(err.message),
    'item with history cannot be deleted'
  );
  assert.ok(await inventoryService.get(silage.id), 'item with history still exists');
});

test('farm scoping keeps other farms data invisible and unusable', async () => {
  db.prepare("INSERT INTO farms (id, name, currency, milk_unit, week_start) VALUES (2, 'Other Farm', 'PKR', 'L', 'monday')").run();
  const info = db
    .prepare("INSERT INTO inventory_items (farm_id, name, category, unit) VALUES (2, 'Foreign Item', 'silage', 'kg')")
    .run();
  const foreignId = info.lastInsertRowid;

  assert.ok(!(await inventoryService.list()).some((i) => i.id === foreignId), 'foreign item not listed');
  await expectStatus(() => inventoryService.get(foreignId), 404, 'foreign item not readable');
  await expectFieldError(
    () => movementService.create({ item_id: foreignId, date: today, type: 'opening', quantity: 1, unit: 'kg' }),
    'item_id',
    'movement for foreign item rejected'
  );
});

test('failed updates leave movements and transactions unchanged', async () => {
  const item = await inventoryService.create({ name: 'Atomicity Item', category: 'other', unit: 'kg' });
  const purchase = await movementService.create({
    item_id: item.id,
    date: today,
    type: 'purchase',
    quantity: 100,
    unit: 'kg',
    total_cost: 500
  });

  await assert.rejects(
    () =>
      movementService.update(purchase.id, {
        item_id: item.id,
        date: today,
        type: 'consumption',
        quantity: 999999,
        unit: 'kg'
      }),
    (err) => err.status === 400,
    'invalid update rejected'
  );

  const unchanged = await movementService.get(purchase.id);
  assert.equal(unchanged.type, 'purchase');
  assert.equal(unchanged.quantity, 100);
  assert.equal(unchanged.transaction_id, purchase.transaction_id);

  const tx = db.prepare('SELECT amount FROM transactions WHERE id = ?').get(purchase.transaction_id);
  assert.equal(tx.amount, 500, 'linked expense untouched after a failed update');
});

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
  fs.rmSync(process.env.BACKUP_DIR, { recursive: true, force: true });
});

const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { INVENTORY_MOVEMENT_TYPES, ADJUSTMENT_DIRECTIONS } = require('../constants/enums');
const inventoryService = require('./inventoryService');

const TYPE_LABELS = {
  opening: 'Opening stock',
  purchase: 'Purchase',
  consumption: 'Consumption',
  waste: 'Waste',
  adjustment: 'Adjustment'
};

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function formatQuantity(value) {
  return String(Number(Number(value).toFixed(3)));
}

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const LIST_SELECT = `
  SELECT m.*,
         i.name AS item_name,
         i.unit AS item_unit,
         i.category AS item_category,
         i.active AS item_active
  FROM inventory_movements m
  JOIN inventory_items i ON i.id = m.item_id
`;

function list(query = {}) {
  const where = ['m.farm_id = ?'];
  const params = [FARM_ID];

  if (query.item_id) {
    where.push('m.item_id = ?');
    params.push(Number(query.item_id));
  }
  if (query.type) {
    where.push('m.type = ?');
    params.push(query.type);
  }
  if (query.from) {
    where.push('m.date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('m.date <= ?');
    params.push(query.to);
  }
  if (query.search) {
    where.push('(i.name LIKE ? OR m.supplier LIKE ? OR m.notes LIKE ?)');
    const s = '%' + query.search + '%';
    params.push(s, s, s);
  }

  const whereSql = where.join(' AND ');
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id WHERE ${whereSql}`
    )
    .get(...params).n;

  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);

  const items = db
    .prepare(`${LIST_SELECT} WHERE ${whereSql} ORDER BY m.date DESC, m.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { items, total, limit, offset };
}

function get(id) {
  const movement = db.prepare(`${LIST_SELECT} WHERE m.id = ? AND m.farm_id = ?`).get(id, FARM_ID);
  if (!movement) throw new HttpError(404, 'Stock movement not found.');
  return movement;
}

function assertItem(itemId) {
  const item = db
    .prepare('SELECT id, name, unit, active FROM inventory_items WHERE id = ? AND farm_id = ?')
    .get(itemId, FARM_ID);
  if (!item) {
    throw new HttpError(400, 'Selected inventory item was not found.', {
      item_id: 'Selected inventory item was not found.'
    });
  }
  return item;
}

const RULES = {
  item_id: { required: true, type: 'integer', label: 'Item' },
  date: { required: true, type: 'date', label: 'Date' },
  type: { required: true, enum: INVENTORY_MOVEMENT_TYPES, label: 'Movement type' },
  quantity: {
    required: true,
    type: 'number',
    label: 'Quantity',
    validate: (v) => (v <= 0 ? 'Quantity must be greater than 0.' : null)
  },
  direction: { enum: ADJUSTMENT_DIRECTIONS, default: 'increase', label: 'Adjustment direction' },
  unit: { label: 'Unit', maxLength: 20 },
  unit_cost: {
    type: 'number',
    label: 'Unit cost',
    validate: (v) => (v < 0 ? 'Unit cost cannot be negative.' : null)
  },
  total_cost: {
    type: 'number',
    label: 'Total cost',
    validate: (v) => (v < 0 ? 'Total cost cannot be negative.' : null)
  },
  supplier: { label: 'Supplier', maxLength: 120 },
  notes: { label: 'Notes', maxLength: 2000 }
};

function fieldError(field, message) {
  throw new HttpError(400, 'Please check the highlighted fields.', { [field]: message });
}

function signFor(type, direction) {
  if (type === 'opening' || type === 'purchase') return 1;
  if (type === 'consumption' || type === 'waste') return -1;
  return direction === 'decrease' ? -1 : 1;
}

function prepare(body, existing) {
  const data = validate(body, RULES);
  const item = assertItem(data.item_id);

  if (data.type === 'adjustment' && !data.notes) {
    fieldError('notes', 'A reason is required for adjustments.');
  }

  const isPurchase = data.type === 'purchase';
  if (!isPurchase && (data.unit_cost !== null || data.total_cost !== null)) {
    fieldError('total_cost', 'Costs can only be recorded on purchase movements.');
  }

  if (data.unit && data.unit !== item.unit) {
    fieldError('unit', `Unit must be ${item.unit} for this item.`);
  }
  data.unit = item.unit;

  if (!item.active && data.type !== 'adjustment') {
    fieldError('item_id', 'This item is inactive. Only adjustments can be recorded.');
  }

  const signed = round3(signFor(data.type, data.direction) * data.quantity);
  const sameItem = existing ? existing.item_id === data.item_id : false;
  const existingSigned = sameItem ? existing.quantity : 0;
  const stockWithout = round3(inventoryService.currentStock(item.id) - existingSigned);
  if (signed < 0 && stockWithout + signed < 0) {
    throw new HttpError(400, 'This movement would make the stock negative.', {
      quantity: `Only ${formatQuantity(stockWithout)} ${item.unit} available.`
    });
  }

  let unitCost = null;
  let totalCost = null;
  if (isPurchase) {
    unitCost = data.unit_cost;
    totalCost = data.total_cost;
    if (totalCost === null && unitCost !== null) {
      totalCost = round2(unitCost * data.quantity);
    }
  }

  return { data, item, signed, unitCost, totalCost };
}

function expenseDescription(item, data) {
  const base = `${TYPE_LABELS.purchase}: ${item.name} (${formatQuantity(data.quantity)} ${item.unit})`;
  return data.supplier ? `${base} — ${data.supplier}` : base;
}

function insertExpense(item, data, amount) {
  const info = db
    .prepare(
      `INSERT INTO transactions (farm_id, animal_id, date, type, category, amount, description)
       VALUES (?, NULL, ?, 'expense', 'feed', ?, ?)`
    )
    .run(FARM_ID, data.date, amount, expenseDescription(item, data));
  return info.lastInsertRowid;
}

function updateExpense(transactionId, item, data, amount) {
  db.prepare(
    `UPDATE transactions SET date = ?, amount = ?, description = ?, updated_at = datetime('now')
     WHERE id = ? AND farm_id = ?`
  ).run(data.date, amount, expenseDescription(item, data), transactionId, FARM_ID);
}

function create(body) {
  const { data, item, signed, unitCost, totalCost } = prepare(body, null);

  const run = db.transaction(() => {
    let transactionId = null;
    if (data.type === 'purchase' && totalCost !== null && totalCost > 0) {
      transactionId = insertExpense(item, data, totalCost);
    }

    const info = db
      .prepare(
        `INSERT INTO inventory_movements
           (farm_id, item_id, date, type, quantity, unit, unit_cost, total_cost, supplier, notes, transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        FARM_ID,
        data.item_id,
        data.date,
        data.type,
        signed,
        data.unit,
        unitCost,
        totalCost,
        data.supplier,
        data.notes,
        transactionId
      );
    return info.lastInsertRowid;
  });

  return get(run());
}

function update(id, body) {
  const existing = db.prepare('SELECT * FROM inventory_movements WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Stock movement not found.');

  const { data, item, signed, unitCost, totalCost } = prepare(body, existing);

  const run = db.transaction(() => {
    let transactionId = existing.transaction_id;
    const wantsExpense = data.type === 'purchase' && totalCost !== null && totalCost > 0;

    if (wantsExpense) {
      if (transactionId) {
        updateExpense(transactionId, item, data, totalCost);
      } else {
        transactionId = insertExpense(item, data, totalCost);
      }
    } else if (transactionId) {
      db.prepare('DELETE FROM transactions WHERE id = ? AND farm_id = ?').run(transactionId, FARM_ID);
      transactionId = null;
    }

    db.prepare(
      `UPDATE inventory_movements SET
         item_id = ?, date = ?, type = ?, quantity = ?, unit = ?, unit_cost = ?, total_cost = ?,
         supplier = ?, notes = ?, transaction_id = ?, updated_at = datetime('now')
       WHERE id = ? AND farm_id = ?`
    ).run(
      data.item_id,
      data.date,
      data.type,
      signed,
      data.unit,
      unitCost,
      totalCost,
      data.supplier,
      data.notes,
      transactionId,
      id,
      FARM_ID
    );
  });

  run();
  return get(id);
}

function remove(id) {
  const existing = db.prepare('SELECT * FROM inventory_movements WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Stock movement not found.');

  const stockWithout = round3(inventoryService.currentStock(existing.item_id) - existing.quantity);
  if (stockWithout < 0) {
    throw new HttpError(400, 'Deleting this movement would make the stock negative.');
  }

  const run = db.transaction(() => {
    db.prepare('DELETE FROM inventory_movements WHERE id = ? AND farm_id = ?').run(id, FARM_ID);
    if (existing.transaction_id) {
      db.prepare('DELETE FROM transactions WHERE id = ? AND farm_id = ?').run(existing.transaction_id, FARM_ID);
    }
  });

  run();
  return { ok: true };
}

module.exports = { list, get, create, update, remove };

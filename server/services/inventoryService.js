const db = require('../db');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { INVENTORY_CATEGORIES } = require('../constants/enums');

const LIST_SELECT = `
  SELECT i.*,
         COALESCE(m.current_stock, 0) AS current_stock,
         COALESCE(m.movements_count, 0) AS movements_count,
         m.last_movement_date
  FROM inventory_items i
  LEFT JOIN (
    SELECT item_id, SUM(quantity) AS current_stock, CAST(COUNT(*) AS INTEGER) AS movements_count,
           MAX(date) AS last_movement_date
    FROM inventory_movements
    WHERE farm_id = ?
    GROUP BY item_id
  ) m ON m.item_id = i.id
`;

async function list(query = {}) {
  const where = ['i.farm_id = ?'];
  const params = [FARM_ID];

  if (query.category) {
    where.push('i.category = ?');
    params.push(query.category);
  }
  if (query.search) {
    where.push('(i.name LIKE ? OR i.notes LIKE ?)');
    const s = '%' + query.search + '%';
    params.push(s, s);
  }
  if (query.status === 'active') {
    where.push('i.active = 1');
  } else if (query.status === 'inactive') {
    where.push('i.active = 0');
  } else if (query.status === 'low') {
    where.push(
      'i.active = 1 AND COALESCE(m.current_stock, 0) > 0 AND i.minimum_stock IS NOT NULL AND COALESCE(m.current_stock, 0) <= i.minimum_stock'
    );
  } else if (query.status === 'out') {
    where.push('i.active = 1 AND COALESCE(m.current_stock, 0) <= 0');
  }

  return db.all(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY i.active DESC, LOWER(i.name) ASC`, [
    FARM_ID,
    ...params
  ]);
}

async function get(id) {
  const item = await db.get(`${LIST_SELECT} WHERE i.id = ? AND i.farm_id = ?`, [FARM_ID, id, FARM_ID]);
  if (!item) throw new HttpError(404, 'Inventory item not found.');
  return item;
}

async function breakdown(itemId) {
  return db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'opening' THEN quantity END), 0) AS opening,
       COALESCE(SUM(CASE WHEN type = 'purchase' THEN quantity END), 0) AS purchased,
       COALESCE(SUM(CASE WHEN type = 'consumption' THEN quantity END), 0) AS consumed,
       COALESCE(SUM(CASE WHEN type = 'waste' THEN quantity END), 0) AS wasted,
       COALESCE(SUM(CASE WHEN type = 'adjustment' THEN quantity END), 0) AS adjusted,
       COALESCE(SUM(quantity), 0) AS current_stock,
       CAST(COUNT(*) AS INTEGER) AS movements_count,
       MAX(date) AS last_movement_date
     FROM inventory_movements
     WHERE farm_id = ? AND item_id = ?`,
    [FARM_ID, itemId]
  );
}

async function profile(id) {
  const item = await get(id);
  const b = await breakdown(id);
  return {
    item,
    stock: {
      current: b.current_stock,
      opening: b.opening,
      purchased: b.purchased,
      consumed: Math.abs(b.consumed),
      wasted: Math.abs(b.wasted),
      adjusted: b.adjusted,
      movements_count: b.movements_count,
      last_movement_date: b.last_movement_date
    }
  };
}

async function currentStock(itemId) {
  const row = await db.get(
    'SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_movements WHERE farm_id = ? AND item_id = ?',
    [FARM_ID, itemId]
  );
  return row.total;
}

async function summary() {
  const rows = await db.all(
    `SELECT i.active, i.minimum_stock, COALESCE(m.current_stock, 0) AS current_stock
     FROM inventory_items i
     LEFT JOIN (
       SELECT item_id, SUM(quantity) AS current_stock
       FROM inventory_movements
       WHERE farm_id = ?
       GROUP BY item_id
     ) m ON m.item_id = i.id
     WHERE i.farm_id = ?`,
    [FARM_ID, FARM_ID]
  );

  let activeCount = 0;
  let lowStock = 0;
  let outOfStock = 0;
  for (const row of rows) {
    if (!row.active) continue;
    activeCount++;
    if (row.current_stock <= 0) {
      outOfStock++;
    } else if (row.minimum_stock !== null && row.current_stock <= row.minimum_stock) {
      lowStock++;
    }
  }

  return { active_count: activeCount, low_stock_count: lowStock, out_of_stock_count: outOfStock };
}

const RULES = {
  name: { required: true, label: 'Name', maxLength: 120 },
  category: { required: true, enum: INVENTORY_CATEGORIES, label: 'Category' },
  unit: {
    required: true,
    label: 'Unit',
    maxLength: 20,
    validate: (v) =>
      /^[A-Za-z][A-Za-z.\-/ ]*$/.test(v) ? null : 'Unit must contain letters only (e.g. kg, bag, bale, L).'
  },
  minimum_stock: {
    type: 'number',
    label: 'Minimum stock',
    validate: (v) => (v < 0 ? 'Minimum stock cannot be negative.' : null)
  },
  active: { type: 'integer', enum: [0, 1], default: 1, label: 'Active' },
  notes: { label: 'Notes', maxLength: 2000 }
};

async function create(body) {
  const data = validate(body, RULES);
  try {
    const info = await db.run(
      `INSERT INTO inventory_items (farm_id, name, category, unit, minimum_stock, active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [FARM_ID, data.name, data.category, data.unit, data.minimum_stock, data.active, data.notes]
    );
    return get(info.lastInsertRowid);
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, `An inventory item named "${data.name}" already exists.`);
    }
    throw err;
  }
}

async function update(id, body) {
  const existing = await get(id);
  const data = validate(body, RULES);
  try {
    await db.run(
      `UPDATE inventory_items SET
         name = ?, category = ?, unit = ?, minimum_stock = ?, active = ?, notes = ?, updated_at = ?
       WHERE id = ? AND farm_id = ?`,
      [data.name, data.category, data.unit, data.minimum_stock, data.active, data.notes, db.now(), existing.id, FARM_ID]
    );
    return get(existing.id);
  } catch (err) {
    if (db.isUniqueViolation(err)) {
      throw new HttpError(409, `An inventory item named "${data.name}" already exists.`);
    }
    throw err;
  }
}

async function remove(id) {
  const item = await get(id);
  if (item.movements_count > 0) {
    throw new HttpError(
      409,
      'This item has stock movements and cannot be deleted. Mark it inactive instead.'
    );
  }
  await db.run('DELETE FROM inventory_items WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  return { ok: true };
}

module.exports = { list, get, profile, currentStock, summary, create, update, remove };

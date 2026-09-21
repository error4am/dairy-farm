const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { TX_TYPES } = require('../constants/enums');
const { isValidCategory } = require('../constants/categories');

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const LIST_JOINS = `
  LEFT JOIN animals a ON a.id = t.animal_id
  LEFT JOIN employee_payments ep ON ep.transaction_id = t.id
  LEFT JOIN employees e ON e.id = ep.employee_id
  LEFT JOIN health_records hr ON hr.transaction_id = t.id
  LEFT JOIN inventory_movements im ON im.transaction_id = t.id
`;

function findLink(transactionId) {
  const employeeLink = db
    .prepare(
      `SELECT ep.id AS payment_id, ep.employee_id, e.name AS employee_name
       FROM employee_payments ep
       JOIN employees e ON e.id = ep.employee_id
       WHERE ep.transaction_id = ?`
    )
    .get(transactionId);
  if (employeeLink) return { kind: 'employee_payment', ...employeeLink };

  const healthLink = db.prepare('SELECT id FROM health_records WHERE transaction_id = ?').get(transactionId);
  if (healthLink) return { kind: 'health_record', health_record_id: healthLink.id };

  const inventoryLink = db
    .prepare('SELECT id AS movement_id, item_id FROM inventory_movements WHERE transaction_id = ?')
    .get(transactionId);
  if (inventoryLink) return { kind: 'inventory_movement', ...inventoryLink };

  return null;
}

function assertNotLinked(transactionId) {
  const link = findLink(transactionId);
  if (!link) return;
  if (link.kind === 'employee_payment') {
    throw new HttpError(
      409,
      'This expense is linked to an employee payment. Edit or delete it from the Employees module.'
    );
  }
  if (link.kind === 'inventory_movement') {
    throw new HttpError(
      409,
      'This expense is linked to an inventory purchase. Edit or delete it from the Inventory module.'
    );
  }
  throw new HttpError(409, 'This expense is linked to a health record. Edit or delete it from the Health module.');
}

function list(query = {}) {
  const where = ['t.farm_id = ?'];
  const params = [FARM_ID];

  if (query.from) {
    where.push('t.date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('t.date <= ?');
    params.push(query.to);
  }
  if (query.type) {
    where.push('t.type = ?');
    params.push(query.type);
  }
  if (query.category) {
    where.push('t.category = ?');
    params.push(query.category);
  }
  if (query.animal_id) {
    where.push('t.animal_id = ?');
    params.push(Number(query.animal_id));
  }
  if (query.search) {
    where.push('(t.description LIKE ? OR a.tag_number LIKE ? OR a.name LIKE ? OR e.name LIKE ?)');
    const s = '%' + query.search + '%';
    params.push(s, s, s, s);
  }

  const whereSql = where.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM transactions t ${LIST_JOINS} WHERE ${whereSql}`)
    .get(...params).n;

  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);

  const items = db
    .prepare(
      `SELECT t.*, a.tag_number AS animal_tag, a.name AS animal_name,
              e.id AS employee_id, e.name AS employee_name, e.employee_id AS employee_code,
              ep.type AS payment_type, hr.id AS health_record_id,
              im.id AS inventory_movement_id, im.item_id AS inventory_item_id
       FROM transactions t
       ${LIST_JOINS}
       WHERE ${whereSql}
       ORDER BY t.date DESC, t.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { items, total, limit, offset };
}

function totals(query = {}) {
  const where = ['farm_id = ?'];
  const params = [FARM_ID];

  if (query.from) {
    where.push('date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('date <= ?');
    params.push(query.to);
  }
  if (query.animal_id) {
    where.push('animal_id = ?');
    params.push(Number(query.animal_id));
  }
  if (query.category) {
    where.push('category = ?');
    params.push(query.category);
  }

  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expenses,
         COUNT(*) AS count
       FROM transactions WHERE ${where.join(' AND ')}`
    )
    .get(...params);

  return {
    from: query.from || null,
    to: query.to || null,
    income: row.income,
    expenses: row.expenses,
    net: row.income - row.expenses,
    count: row.count
  };
}

function summary(query = {}) {
  const range = totals(query);
  const allTime = totals();

  const where = ['farm_id = ?'];
  const params = [FARM_ID];

  if (query.from) {
    where.push('date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('date <= ?');
    params.push(query.to);
  }
  if (query.animal_id) {
    where.push('animal_id = ?');
    params.push(Number(query.animal_id));
  }

  const byCategory = db
    .prepare(
      `SELECT type, category, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
       FROM transactions WHERE ${where.join(' AND ')}
       GROUP BY type, category
       ORDER BY amount DESC`
    )
    .all(...params);

  return { range, all_time: allTime, by_category: byCategory };
}

function assertAnimal(animalId) {
  if (animalId === null || animalId === undefined) return null;
  const animal = db.prepare('SELECT id FROM animals WHERE id = ? AND farm_id = ?').get(animalId, FARM_ID);
  if (!animal) {
    throw new HttpError(400, 'Selected animal was not found.', { animal_id: 'Selected animal was not found.' });
  }
  return animal.id;
}

const RULES = {
  date: { required: true, type: 'date', label: 'Date' },
  type: { required: true, enum: TX_TYPES, label: 'Type' },
  category: { required: true, label: 'Category', maxLength: 50 },
  amount: {
    required: true,
    type: 'number',
    label: 'Amount',
    validate: (v) => (v <= 0 ? 'Amount must be greater than 0.' : null)
  },
  description: { label: 'Description', maxLength: 500 },
  animal_id: { type: 'integer', label: 'Animal' }
};

function create(body) {
  const data = validate(body, RULES);
  if (!isValidCategory(data.type, data.category)) {
    throw new HttpError(400, 'Please check the highlighted fields.', {
      category: 'Category does not match the transaction type.'
    });
  }
  assertAnimal(data.animal_id);

  const info = db
    .prepare(
      `INSERT INTO transactions (farm_id, animal_id, date, type, category, amount, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(FARM_ID, data.animal_id, data.date, data.type, data.category, data.amount, data.description);
  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid);
}

function update(id, body) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Transaction not found.');

  assertNotLinked(id);

  const data = validate(body, RULES);
  if (!isValidCategory(data.type, data.category)) {
    throw new HttpError(400, 'Please check the highlighted fields.', {
      category: 'Category does not match the transaction type.'
    });
  }
  assertAnimal(data.animal_id);

  db.prepare(
    `UPDATE transactions SET
       animal_id = ?, date = ?, type = ?, category = ?, amount = ?, description = ?,
       updated_at = datetime('now')
     WHERE id = ? AND farm_id = ?`
  ).run(data.animal_id, data.date, data.type, data.category, data.amount, data.description, id, FARM_ID);

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
}

function remove(id) {
  const existing = db.prepare('SELECT id FROM transactions WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Transaction not found.');

  assertNotLinked(id);

  db.prepare('DELETE FROM transactions WHERE id = ? AND farm_id = ?').run(id, FARM_ID);
  return { ok: true };
}

module.exports = { list, totals, summary, create, update, remove };

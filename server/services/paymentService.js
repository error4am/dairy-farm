const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { PAYMENT_TYPES } = require('../constants/enums');

const TYPE_LABELS = {
  salary: 'Salary payment',
  advance: 'Advance',
  bonus: 'Bonus',
  other: 'Other payment'
};

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const LIST_SELECT = `
  SELECT p.*, e.name AS employee_name, e.employee_id AS employee_code, e.status AS employee_status
  FROM employee_payments p
  JOIN employees e ON e.id = p.employee_id
`;

function list(query = {}) {
  const where = ['p.farm_id = ?'];
  const params = [FARM_ID];

  if (query.employee_id) {
    where.push('p.employee_id = ?');
    params.push(Number(query.employee_id));
  }
  if (query.type) {
    where.push('p.type = ?');
    params.push(query.type);
  }
  if (query.from) {
    where.push('p.date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('p.date <= ?');
    params.push(query.to);
  }
  if (query.search) {
    where.push('(e.name LIKE ? OR e.employee_id LIKE ? OR p.description LIKE ?)');
    const s = '%' + query.search + '%';
    params.push(s, s, s);
  }

  const whereSql = where.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM employee_payments p JOIN employees e ON e.id = p.employee_id WHERE ${whereSql}`)
    .get(...params).n;

  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);

  const items = db
    .prepare(`${LIST_SELECT} WHERE ${whereSql} ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { items, total, limit, offset };
}

function get(id) {
  const payment = db.prepare(`${LIST_SELECT} WHERE p.id = ? AND p.farm_id = ?`).get(id, FARM_ID);
  if (!payment) throw new HttpError(404, 'Payment not found.');
  return payment;
}

function assertEmployee(employeeId) {
  const employee = db
    .prepare('SELECT id, name, employee_id, status FROM employees WHERE id = ? AND farm_id = ?')
    .get(employeeId, FARM_ID);
  if (!employee) {
    throw new HttpError(400, 'Selected employee was not found.', { employee_id: 'Selected employee was not found.' });
  }
  return employee;
}

function descriptionFor(employee, type) {
  return `${TYPE_LABELS[type]} — ${employee.name}`;
}

function insertExpense(data, employee) {
  const info = db
    .prepare(
      `INSERT INTO transactions (farm_id, animal_id, date, type, category, amount, description)
       VALUES (?, NULL, ?, 'expense', 'labor', ?, ?)`
    )
    .run(FARM_ID, data.date, data.amount, descriptionFor(employee, data.type));
  return info.lastInsertRowid;
}

const RULES = {
  employee_id: { required: true, type: 'integer', label: 'Employee' },
  date: { required: true, type: 'date', label: 'Date' },
  type: { required: true, enum: PAYMENT_TYPES, label: 'Payment type' },
  amount: {
    required: true,
    type: 'number',
    label: 'Amount',
    validate: (v) => (v <= 0 ? 'Amount must be greater than 0.' : null)
  },
  description: { label: 'Description', maxLength: 300 },
  notes: { label: 'Notes', maxLength: 2000 }
};

function create(body) {
  const data = validate(body, RULES);
  const employee = assertEmployee(data.employee_id);

  const run = db.transaction(() => {
    const transactionId = insertExpense(data, employee);
    const info = db
      .prepare(
        `INSERT INTO employee_payments (farm_id, employee_id, transaction_id, date, type, amount, description, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        FARM_ID,
        data.employee_id,
        transactionId,
        data.date,
        data.type,
        data.amount,
        data.description,
        data.notes
      );
    return info.lastInsertRowid;
  });

  return get(run());
}

function update(id, body) {
  const existing = db.prepare('SELECT * FROM employee_payments WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Payment not found.');

  const data = validate(body, RULES);
  const employee = assertEmployee(data.employee_id);

  const run = db.transaction(() => {
    let transactionId = existing.transaction_id;

    if (transactionId) {
      db.prepare(
        `UPDATE transactions SET date = ?, amount = ?, description = ?, updated_at = datetime('now')
         WHERE id = ? AND farm_id = ?`
      ).run(data.date, data.amount, descriptionFor(employee, data.type), transactionId, FARM_ID);
    } else {
      transactionId = insertExpense(data, employee);
    }

    db.prepare(
      `UPDATE employee_payments SET
         employee_id = ?, transaction_id = ?, date = ?, type = ?, amount = ?, description = ?, notes = ?,
         updated_at = datetime('now')
       WHERE id = ? AND farm_id = ?`
    ).run(
      data.employee_id,
      transactionId,
      data.date,
      data.type,
      data.amount,
      data.description,
      data.notes,
      id,
      FARM_ID
    );
  });

  run();
  return get(id);
}

function remove(id) {
  const existing = db.prepare('SELECT * FROM employee_payments WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Payment not found.');

  const run = db.transaction(() => {
    db.prepare('DELETE FROM employee_payments WHERE id = ? AND farm_id = ?').run(id, FARM_ID);
    if (existing.transaction_id) {
      db.prepare('DELETE FROM transactions WHERE id = ? AND farm_id = ?').run(existing.transaction_id, FARM_ID);
    }
  });

  run();
  return { ok: true };
}

module.exports = { list, get, create, update, remove };

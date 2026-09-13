const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { EMPLOYEE_STATUSES, PAY_TYPES } = require('../constants/enums');
const { todayLocal } = require('../utils/date');

const SORTABLE = {
  name: 'e.name',
  role: 'e.role',
  status: 'e.status',
  salary: 'e.salary',
  joining_date: 'e.joining_date',
  created_at: 'e.created_at',
  paid_total: 'paid_total'
};

const LIST_SELECT = `
  SELECT e.*,
         COALESCE(p.paid_total, 0) AS paid_total,
         p.last_payment_date,
         COALESCE(p.payments_count, 0) AS payments_count
  FROM employees e
  LEFT JOIN (
    SELECT employee_id, SUM(amount) AS paid_total, MAX(date) AS last_payment_date, COUNT(*) AS payments_count
    FROM employee_payments
    WHERE farm_id = ?
    GROUP BY employee_id
  ) p ON p.employee_id = e.id
`;

function list(query = {}) {
  const where = ['e.farm_id = ?'];
  const params = [FARM_ID];

  if (query.status) {
    where.push('e.status = ?');
    params.push(query.status);
  }
  if (query.role) {
    where.push('e.role = ?');
    params.push(query.role);
  }
  if (query.search) {
    where.push('(e.name LIKE ? OR e.employee_id LIKE ? OR e.phone LIKE ? OR e.role LIKE ?)');
    const s = '%' + query.search + '%';
    params.push(s, s, s, s);
  }

  const order = SORTABLE[query.sort] || SORTABLE.created_at;
  const direction = String(query.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  return db
    .prepare(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} ${direction}, e.id DESC`)
    .all(FARM_ID, ...params);
}

function get(id) {
  const employee = db.prepare(`${LIST_SELECT} WHERE e.id = ? AND e.farm_id = ?`).get(FARM_ID, id, FARM_ID);
  if (!employee) throw new HttpError(404, 'Employee not found.');
  return employee;
}

function summary() {
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM employees WHERE farm_id = ? AND status = 'active'")
    .get(FARM_ID).n;
  const inactive = db
    .prepare("SELECT COUNT(*) AS n FROM employees WHERE farm_id = ? AND status = 'inactive'")
    .get(FARM_ID).n;
  const roles = db
    .prepare(
      `SELECT DISTINCT role FROM employees
       WHERE farm_id = ? AND role IS NOT NULL AND role <> ''
       ORDER BY role`
    )
    .all(FARM_ID)
    .map((r) => r.role);

  return { active_count: active, inactive_count: inactive, roles };
}

function profile(id) {
  const employee = get(id);

  const finance = db
    .prepare(
      `SELECT
         COALESCE(SUM(amount), 0) AS total_paid,
         COALESCE(SUM(CASE WHEN substr(date, 1, 7) = substr(?, 1, 7) THEN amount END), 0) AS this_month_paid,
         COALESCE(SUM(CASE WHEN type = 'advance' THEN amount END), 0) AS total_advances,
         COUNT(*) AS payments_count,
         MAX(date) AS last_payment_date
       FROM employee_payments WHERE farm_id = ? AND employee_id = ?`
    )
    .get(todayLocal(), FARM_ID, id);

  const recentPayments = db
    .prepare(
      `SELECT * FROM employee_payments
       WHERE farm_id = ? AND employee_id = ?
       ORDER BY date DESC, id DESC LIMIT 50`
    )
    .all(FARM_ID, id);

  const monthlyPaid = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, SUM(amount) AS total
       FROM employee_payments
       WHERE farm_id = ? AND employee_id = ?
       GROUP BY month ORDER BY month DESC LIMIT 6`
    )
    .all(FARM_ID, id);

  return {
    employee,
    finance: { ...finance, outstanding_advances: finance.total_advances },
    recent_payments: recentPayments,
    monthly_paid: monthlyPaid
  };
}

const RULES = {
  name: { required: true, label: 'Full name', maxLength: 120 },
  phone: { label: 'Phone', maxLength: 30 },
  role: { label: 'Role / job', maxLength: 100 },
  joining_date: { type: 'date', label: 'Joining date' },
  status: { enum: EMPLOYEE_STATUSES, default: 'active', label: 'Status' },
  pay_type: { required: true, enum: PAY_TYPES, label: 'Pay type' },
  salary: {
    required: true,
    type: 'number',
    label: 'Salary / wage',
    validate: (v) => (v < 0 ? 'Salary cannot be negative.' : null)
  },
  notes: { label: 'Notes', maxLength: 2000 }
};

function nextEmployeeCode() {
  const rows = db.prepare('SELECT employee_id FROM employees WHERE farm_id = ?').all(FARM_ID);
  let max = 0;
  for (const row of rows) {
    const match = /^EMP-(\d+)$/.exec(row.employee_id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return 'EMP-' + String(max + 1).padStart(3, '0');
}

function create(body) {
  const data = validate(body, RULES);
  const info = db
    .prepare(
      `INSERT INTO employees
         (farm_id, employee_id, name, phone, role, joining_date, status, pay_type, salary, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      FARM_ID,
      nextEmployeeCode(),
      data.name,
      data.phone,
      data.role,
      data.joining_date,
      data.status,
      data.pay_type,
      data.salary,
      data.notes
    );
  return get(info.lastInsertRowid);
}

function update(id, body) {
  const existing = get(id);
  const data = validate(body, RULES);
  db.prepare(
    `UPDATE employees SET
       name = ?, phone = ?, role = ?, joining_date = ?, status = ?, pay_type = ?, salary = ?, notes = ?,
       updated_at = datetime('now')
     WHERE id = ? AND farm_id = ?`
  ).run(
    data.name,
    data.phone,
    data.role,
    data.joining_date,
    data.status,
    data.pay_type,
    data.salary,
    data.notes,
    existing.id,
    FARM_ID
  );
  return get(existing.id);
}

function remove(id) {
  get(id);
  const payments = db.prepare('SELECT COUNT(*) AS n FROM employee_payments WHERE employee_id = ?').get(id).n;
  if (payments > 0) {
    throw new HttpError(
      409,
      'This employee has payment records and cannot be deleted. Mark them Inactive instead.'
    );
  }
  db.prepare('DELETE FROM employees WHERE id = ? AND farm_id = ?').run(id, FARM_ID);
  return { ok: true };
}

module.exports = { list, get, summary, profile, create, update, remove };

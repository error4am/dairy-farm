const db = require('../db');
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
    SELECT employee_id, SUM(amount) AS paid_total, MAX(date) AS last_payment_date,
           CAST(COUNT(*) AS INTEGER) AS payments_count
    FROM employee_payments
    WHERE farm_id = ?
    GROUP BY employee_id
  ) p ON p.employee_id = e.id
`;

async function list(query = {}) {
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

  return db.all(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} ${direction}, e.id DESC`, [
    FARM_ID,
    ...params
  ]);
}

async function get(id) {
  const employee = await db.get(`${LIST_SELECT} WHERE e.id = ? AND e.farm_id = ?`, [FARM_ID, id, FARM_ID]);
  if (!employee) throw new HttpError(404, 'Employee not found.');
  return employee;
}

async function summary() {
  const active = (
    await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM employees WHERE farm_id = ? AND status = 'active'", [
      FARM_ID
    ])
  ).n;
  const inactive = (
    await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM employees WHERE farm_id = ? AND status = 'inactive'", [
      FARM_ID
    ])
  ).n;
  const roles = (
    await db.all(
      `SELECT DISTINCT role FROM employees
       WHERE farm_id = ? AND role IS NOT NULL AND role <> ''
       ORDER BY role`,
      [FARM_ID]
    )
  ).map((r) => r.role);

  return { active_count: active, inactive_count: inactive, roles };
}

async function profile(id) {
  const employee = await get(id);

  const finance = await db.get(
    `SELECT
       COALESCE(SUM(amount), 0) AS total_paid,
       COALESCE(SUM(CASE WHEN substr(date, 1, 7) = substr(?, 1, 7) THEN amount END), 0) AS this_month_paid,
       COALESCE(SUM(CASE WHEN type = 'advance' THEN amount END), 0) AS total_advances,
       CAST(COUNT(*) AS INTEGER) AS payments_count,
       MAX(date) AS last_payment_date
     FROM employee_payments WHERE farm_id = ? AND employee_id = ?`,
    [todayLocal(), FARM_ID, id]
  );

  const recentPayments = await db.all(
    `SELECT * FROM employee_payments
     WHERE farm_id = ? AND employee_id = ?
     ORDER BY date DESC, id DESC LIMIT 50`,
    [FARM_ID, id]
  );

  const monthlyPaid = await db.all(
    `SELECT substr(date, 1, 7) AS month, SUM(amount) AS total
     FROM employee_payments
     WHERE farm_id = ? AND employee_id = ?
     GROUP BY substr(date, 1, 7) ORDER BY month DESC LIMIT 6`,
    [FARM_ID, id]
  );

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

async function nextEmployeeCode() {
  const rows = await db.all('SELECT employee_id FROM employees WHERE farm_id = ?', [FARM_ID]);
  let max = 0;
  for (const row of rows) {
    const match = /^EMP-(\d+)$/.exec(row.employee_id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return 'EMP-' + String(max + 1).padStart(3, '0');
}

async function create(body) {
  const data = validate(body, RULES);
  const info = await db.run(
    `INSERT INTO employees
       (farm_id, employee_id, name, phone, role, joining_date, status, pay_type, salary, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      FARM_ID,
      await nextEmployeeCode(),
      data.name,
      data.phone,
      data.role,
      data.joining_date,
      data.status,
      data.pay_type,
      data.salary,
      data.notes
    ]
  );
  return get(info.lastInsertRowid);
}

async function update(id, body) {
  const existing = await get(id);
  const data = validate(body, RULES);
  await db.run(
    `UPDATE employees SET
       name = ?, phone = ?, role = ?, joining_date = ?, status = ?, pay_type = ?, salary = ?, notes = ?,
       updated_at = ?
     WHERE id = ? AND farm_id = ?`,
    [
      data.name,
      data.phone,
      data.role,
      data.joining_date,
      data.status,
      data.pay_type,
      data.salary,
      data.notes,
      db.now(),
      existing.id,
      FARM_ID
    ]
  );
  return get(existing.id);
}

async function remove(id) {
  await get(id);
  const payments = (
    await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM employee_payments WHERE employee_id = ?', [id])
  ).n;
  if (payments > 0) {
    throw new HttpError(
      409,
      'This employee has payment records and cannot be deleted. Mark them Inactive instead.'
    );
  }
  await db.run('DELETE FROM employees WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  return { ok: true };
}

module.exports = { list, get, summary, profile, create, update, remove };

const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { HEALTH_TYPES } = require('../constants/enums');
const { todayLocal, addDays } = require('../utils/date');

const TYPE_LABELS = {
  vaccination: 'Vaccination',
  treatment: 'Treatment',
  illness: 'Illness',
  checkup: 'Checkup',
  deworming: 'Deworming',
  other: 'Health record'
};

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const LIST_SELECT = `
  SELECT h.*,
         a.tag_number AS animal_tag,
         a.name AS animal_name,
         t.amount AS cost
  FROM health_records h
  JOIN animals a ON a.id = h.animal_id
  LEFT JOIN transactions t ON t.id = h.transaction_id
`;

function list(query = {}) {
  const where = ['h.farm_id = ?'];
  const params = [FARM_ID];

  if (query.animal_id) {
    where.push('h.animal_id = ?');
    params.push(Number(query.animal_id));
  }
  if (query.type) {
    where.push('h.type = ?');
    params.push(query.type);
  }
  if (query.from) {
    where.push('h.date >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('h.date <= ?');
    params.push(query.to);
  }
  if (query.due === 'soon') {
    where.push('h.next_due_date IS NOT NULL AND h.next_due_date <= ?');
    params.push(addDays(todayLocal(), 30));
  }
  if (query.withdrawal === 'active') {
    where.push('h.withdrawal_until IS NOT NULL AND h.withdrawal_until >= ?');
    params.push(todayLocal());
  }
  if (query.search) {
    where.push('(h.condition LIKE ? OR h.medicine LIKE ? OR h.vet_name LIKE ? OR a.tag_number LIKE ? OR a.name LIKE ?)');
    const s = '%' + query.search + '%';
    params.push(s, s, s, s, s);
  }

  const whereSql = where.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM health_records h JOIN animals a ON a.id = h.animal_id WHERE ${whereSql}`)
    .get(...params).n;

  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);
  const order =
    query.due === 'soon'
      ? 'h.next_due_date ASC, h.date DESC'
      : query.withdrawal === 'active'
        ? 'h.withdrawal_until ASC, h.date DESC'
        : 'h.date DESC, h.id DESC';

  const items = db
    .prepare(`${LIST_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { items, total, limit, offset };
}

function summary() {
  const today = todayLocal();
  const soon = addDays(today, 30);

  const eventsThisMonth = db
    .prepare("SELECT COUNT(*) AS n FROM health_records WHERE farm_id = ? AND substr(date, 1, 7) = substr(?, 1, 7)")
    .get(FARM_ID, today).n;

  const byType = db
    .prepare('SELECT type, COUNT(*) AS count FROM health_records WHERE farm_id = ? GROUP BY type ORDER BY count DESC')
    .all(FARM_ID);

  const withdrawals = db
    .prepare(
      `SELECT h.animal_id, a.tag_number, a.name, MAX(h.withdrawal_until) AS withdrawal_until
       FROM health_records h
       JOIN animals a ON a.id = h.animal_id
       WHERE h.farm_id = ? AND h.withdrawal_until IS NOT NULL AND h.withdrawal_until >= ?
       GROUP BY h.animal_id
       ORDER BY withdrawal_until ASC`
    )
    .all(FARM_ID, today);

  const dueSoon = db
    .prepare(
      `SELECT h.id, h.animal_id, a.tag_number, a.name, h.type, h.condition, h.next_due_date
       FROM health_records h
       JOIN animals a ON a.id = h.animal_id
       WHERE h.farm_id = ? AND h.next_due_date IS NOT NULL AND h.next_due_date <= ?
       ORDER BY h.next_due_date ASC
       LIMIT 50`
    )
    .all(FARM_ID, soon);

  return {
    today,
    events_this_month: eventsThisMonth,
    by_type: byType,
    withdrawals,
    withdrawal_count: withdrawals.length,
    due_soon: dueSoon,
    due_soon_count: dueSoon.length
  };
}

function get(id) {
  const record = db.prepare(`${LIST_SELECT} WHERE h.id = ? AND h.farm_id = ?`).get(id, FARM_ID);
  if (!record) throw new HttpError(404, 'Health record not found.');
  return record;
}

function activeWithdrawal(animalId, date) {
  const row = db
    .prepare(
      `SELECT MAX(withdrawal_until) AS until FROM health_records
       WHERE farm_id = ? AND animal_id = ? AND withdrawal_until IS NOT NULL AND date <= ? AND withdrawal_until >= ?`
    )
    .get(FARM_ID, animalId, date, date);
  return row.until || null;
}

function assertAnimal(animalId) {
  const animal = db.prepare('SELECT id, tag_number, name, status FROM animals WHERE id = ? AND farm_id = ?').get(animalId, FARM_ID);
  if (!animal) {
    throw new HttpError(400, 'Selected animal was not found.', { animal_id: 'Selected animal was not found.' });
  }
  return animal;
}

const RULES = {
  animal_id: { required: true, type: 'integer', label: 'Animal' },
  date: { required: true, type: 'date', label: 'Date' },
  type: { required: true, enum: HEALTH_TYPES, label: 'Type' },
  condition: { label: 'Condition', maxLength: 200 },
  medicine: { label: 'Medicine', maxLength: 200 },
  dosage: { label: 'Dosage', maxLength: 100 },
  vet_name: { label: 'Vet name', maxLength: 120 },
  withdrawal_until: { type: 'date', label: 'Withdrawal until' },
  next_due_date: { type: 'date', label: 'Next due date' },
  notes: { label: 'Notes', maxLength: 2000 },
  cost: { type: 'number', label: 'Cost', validate: (v) => (v < 0 ? 'Cost cannot be negative.' : null) }
};

function validateRecord(body) {
  const data = validate(body, RULES);
  if (data.withdrawal_until && data.withdrawal_until < data.date) {
    throw new HttpError(400, 'Please check the highlighted fields.', {
      withdrawal_until: 'Withdrawal date cannot be before the record date.'
    });
  }
  if (data.next_due_date && data.next_due_date < data.date) {
    throw new HttpError(400, 'Please check the highlighted fields.', {
      next_due_date: 'Next due date cannot be before the record date.'
    });
  }
  return data;
}

function expenseDescription(data) {
  const label = data.condition || data.medicine || TYPE_LABELS[data.type];
  return `Health: ${label}`;
}

function insertExpense(data, cost) {
  const info = db
    .prepare(
      `INSERT INTO transactions (farm_id, animal_id, date, type, category, amount, description)
       VALUES (?, ?, ?, 'expense', 'medicine', ?, ?)`
    )
    .run(FARM_ID, data.animal_id, data.date, cost, expenseDescription(data));
  return info.lastInsertRowid;
}

function updateExpense(transactionId, data, cost) {
  db.prepare(
    `UPDATE transactions SET animal_id = ?, date = ?, amount = ?, description = ?, updated_at = datetime('now')
     WHERE id = ? AND farm_id = ?`
  ).run(data.animal_id, data.date, cost, expenseDescription(data), transactionId, FARM_ID);
}

function create(body) {
  const data = validateRecord(body);
  assertAnimal(data.animal_id);
  const cost = data.cost === null ? 0 : data.cost;

  const run = db.transaction(() => {
    let transactionId = null;
    if (cost > 0) transactionId = insertExpense(data, cost);

    const info = db
      .prepare(
        `INSERT INTO health_records
           (farm_id, animal_id, date, type, condition, medicine, dosage, vet_name,
            withdrawal_until, next_due_date, notes, transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        FARM_ID,
        data.animal_id,
        data.date,
        data.type,
        data.condition,
        data.medicine,
        data.dosage,
        data.vet_name,
        data.withdrawal_until,
        data.next_due_date,
        data.notes,
        transactionId
      );
    return info.lastInsertRowid;
  });

  return get(run());
}

function update(id, body) {
  const existing = db.prepare('SELECT * FROM health_records WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Health record not found.');

  const data = validateRecord(body);
  assertAnimal(data.animal_id);
  const cost = data.cost === null ? 0 : data.cost;

  const run = db.transaction(() => {
    let transactionId = existing.transaction_id;

    if (cost > 0) {
      if (transactionId) {
        updateExpense(transactionId, data, cost);
      } else {
        transactionId = insertExpense(data, cost);
      }
    } else if (transactionId) {
      db.prepare('DELETE FROM transactions WHERE id = ? AND farm_id = ?').run(transactionId, FARM_ID);
      transactionId = null;
    }

    db.prepare(
      `UPDATE health_records SET
         animal_id = ?, date = ?, type = ?, condition = ?, medicine = ?, dosage = ?, vet_name = ?,
         withdrawal_until = ?, next_due_date = ?, notes = ?, transaction_id = ?, updated_at = datetime('now')
       WHERE id = ? AND farm_id = ?`
    ).run(
      data.animal_id,
      data.date,
      data.type,
      data.condition,
      data.medicine,
      data.dosage,
      data.vet_name,
      data.withdrawal_until,
      data.next_due_date,
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
  const existing = db.prepare('SELECT * FROM health_records WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Health record not found.');

  const run = db.transaction(() => {
    db.prepare('DELETE FROM health_records WHERE id = ? AND farm_id = ?').run(id, FARM_ID);
    if (existing.transaction_id) {
      db.prepare('DELETE FROM transactions WHERE id = ? AND farm_id = ?').run(existing.transaction_id, FARM_ID);
    }
  });

  run();
  return { ok: true };
}

module.exports = { list, summary, get, create, update, remove, activeWithdrawal };

const db = require('../db/connection');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { validate } = require('../middleware/validate');
const { SERVICE_METHODS, PREGNANCY_RESULTS, CALVING_OUTCOMES } = require('../constants/enums');
const { todayLocal, addDays } = require('../utils/date');

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

const LIST_SELECT = `
  SELECT b.*, a.tag_number AS animal_tag, a.name AS animal_name
  FROM breeding_records b
  JOIN animals a ON a.id = b.animal_id
`;

const CURRENT_PREGNANCY_SELECT = `
  SELECT b.*, a.tag_number AS animal_tag, a.name AS animal_name
  FROM (
    SELECT br.*, ROW_NUMBER() OVER (
      PARTITION BY br.animal_id
      ORDER BY COALESCE(br.service_date, br.heat_date, date(br.created_at)) DESC, br.id DESC
    ) AS rn
    FROM breeding_records br
    WHERE br.farm_id = ? AND br.pregnancy_result != 'pending'
  ) b
  JOIN animals a ON a.id = b.animal_id
  WHERE b.rn = 1 AND b.pregnancy_result = 'pregnant' AND b.actual_calving_date IS NULL
`;

function list(query = {}) {
  const where = ['b.farm_id = ?'];
  const params = [FARM_ID];

  if (query.animal_id) {
    where.push('b.animal_id = ?');
    params.push(Number(query.animal_id));
  }
  if (query.pregnancy_result) {
    where.push('b.pregnancy_result = ?');
    params.push(query.pregnancy_result);
  }
  if (query.service_method) {
    where.push('b.service_method = ?');
    params.push(query.service_method);
  }
  if (query.from) {
    where.push('COALESCE(b.service_date, b.heat_date) >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('COALESCE(b.service_date, b.heat_date) <= ?');
    params.push(query.to);
  }
  if (query.due === 'soon') {
    where.push(
      "b.pregnancy_result = 'pregnant' AND b.actual_calving_date IS NULL AND b.expected_calving_date IS NOT NULL AND b.expected_calving_date <= ?"
    );
    params.push(addDays(todayLocal(), 30));
  }
  if (query.pending_checks === '1' || query.pending_checks === 'true') {
    where.push("b.pregnancy_result = 'pending' AND b.service_date IS NOT NULL");
  }

  const whereSql = where.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM breeding_records b WHERE ${whereSql}`)
    .get(...params).n;

  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);
  const order =
    query.due === 'soon'
      ? 'b.expected_calving_date ASC, b.id DESC'
      : query.pending_checks === '1' || query.pending_checks === 'true'
        ? 'b.service_date ASC, b.id DESC'
        : 'COALESCE(b.service_date, b.heat_date) DESC, b.id DESC';

  const items = db
    .prepare(`${LIST_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { items, total, limit, offset };
}

function summary() {
  const today = todayLocal();
  const soon = addDays(today, 30);

  const currentlyPregnant = db
    .prepare(`${CURRENT_PREGNANCY_SELECT} ORDER BY b.expected_calving_date ASC`)
    .all(FARM_ID);

  const calvingSoon = currentlyPregnant.filter(
    (r) => r.expected_calving_date && r.expected_calving_date <= soon
  );

  const pendingChecks = db
    .prepare(
      `SELECT b.id, b.animal_id, b.heat_date, b.service_date, b.service_method, b.pregnancy_check_date,
              b.sire_info, b.created_at, a.tag_number AS animal_tag, a.name AS animal_name
       FROM breeding_records b
       JOIN animals a ON a.id = b.animal_id
       WHERE b.farm_id = ? AND b.pregnancy_result = 'pending' AND b.service_date IS NOT NULL
       ORDER BY b.service_date ASC
       LIMIT 50`
    )
    .all(FARM_ID);

  const eventsThisMonth = db
    .prepare(
      `SELECT COUNT(*) AS n FROM breeding_records
       WHERE farm_id = ?
         AND (substr(heat_date, 1, 7) = substr(?, 1, 7)
           OR substr(service_date, 1, 7) = substr(?, 1, 7)
           OR substr(pregnancy_check_date, 1, 7) = substr(?, 1, 7)
           OR substr(actual_calving_date, 1, 7) = substr(?, 1, 7))`
    )
    .get(FARM_ID, today, today, today, today).n;

  return {
    today,
    currently_pregnant_count: currentlyPregnant.length,
    calving_soon_count: calvingSoon.length,
    pending_checks_count: pendingChecks.length,
    events_this_month: eventsThisMonth,
    currently_pregnant: currentlyPregnant,
    calving_soon: calvingSoon,
    pending_checks: pendingChecks
  };
}

function get(id) {
  const record = db.prepare(`${LIST_SELECT} WHERE b.id = ? AND b.farm_id = ?`).get(id, FARM_ID);
  if (!record) throw new HttpError(404, 'Breeding record not found.');
  return record;
}

function currentForAnimal(animalId) {
  return db.prepare(`${CURRENT_PREGNANCY_SELECT} AND b.animal_id = ?`).get(FARM_ID, animalId) || null;
}

function assertAnimal(animalId) {
  const animal = db.prepare('SELECT id, tag_number, name FROM animals WHERE id = ? AND farm_id = ?').get(animalId, FARM_ID);
  if (!animal) {
    throw new HttpError(400, 'Selected animal was not found.', { animal_id: 'Selected animal was not found.' });
  }
  return animal;
}

const RULES = {
  animal_id: { required: true, type: 'integer', label: 'Animal' },
  heat_date: { type: 'date', label: 'Heat date' },
  service_date: { type: 'date', label: 'Service date' },
  service_method: { enum: SERVICE_METHODS, label: 'Service method' },
  sire_info: { label: 'Sire / bull', maxLength: 200 },
  pregnancy_check_date: { type: 'date', label: 'Pregnancy check date' },
  pregnancy_result: { enum: PREGNANCY_RESULTS, default: 'pending', label: 'Pregnancy result' },
  expected_calving_date: { type: 'date', label: 'Expected calving date' },
  expected_calving_estimated: { type: 'integer', label: 'Estimated flag' },
  actual_calving_date: { type: 'date', label: 'Actual calving date' },
  calving_outcome: { enum: CALVING_OUTCOMES, default: 'pending', label: 'Calving outcome' },
  offspring_count: {
    type: 'integer',
    label: 'Number of offspring',
    validate: (v) => (v < 0 ? 'Number of offspring cannot be negative.' : null)
  },
  notes: { label: 'Notes', maxLength: 2000 }
};

function invalid(field, message) {
  throw new HttpError(400, 'Please check the highlighted fields.', { [field]: message });
}

function validateRecord(body) {
  const data = validate(body, RULES);

  if (!data.heat_date && !data.service_date) {
    invalid('heat_date', 'Enter a heat date or a service date.');
  }
  if (data.heat_date && data.service_date && data.heat_date > data.service_date) {
    invalid('heat_date', 'Heat date cannot be after the service date.');
  }
  if (data.service_date && !data.service_method) {
    invalid('service_method', 'Select a service method.');
  }
  if (data.service_date && data.pregnancy_check_date && data.pregnancy_check_date < data.service_date) {
    invalid('pregnancy_check_date', 'Pregnancy check cannot be before the service date.');
  }
  if (data.service_date && data.expected_calving_date && data.expected_calving_date <= data.service_date) {
    invalid('expected_calving_date', 'Expected calving date must be after the service date.');
  }
  if (data.service_date && data.actual_calving_date && data.actual_calving_date < data.service_date) {
    invalid('actual_calving_date', 'Calving date cannot be before the service date.');
  }
  if (data.pregnancy_check_date && data.actual_calving_date && data.actual_calving_date < data.pregnancy_check_date) {
    invalid('actual_calving_date', 'Calving date cannot be before the pregnancy check.');
  }
  if (data.actual_calving_date && data.pregnancy_result !== 'pregnant') {
    invalid('actual_calving_date', 'Actual calving requires a confirmed pregnancy.');
  }

  if (data.pregnancy_result === 'pregnant') {
    if (!data.pregnancy_check_date) {
      invalid('pregnancy_check_date', 'Pregnancy check date is required for a confirmed pregnancy.');
    }
    if (!data.expected_calving_date) {
      invalid('expected_calving_date', 'Expected calving date is required for a confirmed pregnancy.');
    }
  } else {
    data.expected_calving_date = null;
    data.expected_calving_estimated = 0;
  }

  if (data.actual_calving_date) {
    if (data.calving_outcome === 'pending') {
      invalid('calving_outcome', 'Select a calving outcome.');
    }
  } else if (data.calving_outcome !== 'pending') {
    invalid('calving_outcome', 'Calving outcome requires an actual calving date.');
  }

  if (data.offspring_count !== null && !data.actual_calving_date) {
    invalid('offspring_count', 'Offspring count requires an actual calving date.');
  }

  data.expected_calving_estimated = data.expected_calving_estimated ? 1 : 0;
  return data;
}

function create(body) {
  const data = validateRecord(body);
  assertAnimal(data.animal_id);

  const info = db
    .prepare(
      `INSERT INTO breeding_records
         (farm_id, animal_id, heat_date, service_date, service_method, sire_info,
          pregnancy_check_date, pregnancy_result, expected_calving_date, expected_calving_estimated,
          actual_calving_date, calving_outcome, offspring_count, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      FARM_ID,
      data.animal_id,
      data.heat_date,
      data.service_date,
      data.service_method,
      data.sire_info,
      data.pregnancy_check_date,
      data.pregnancy_result,
      data.expected_calving_date,
      data.expected_calving_estimated,
      data.actual_calving_date,
      data.calving_outcome,
      data.offspring_count,
      data.notes
    );

  return get(info.lastInsertRowid);
}

function update(id, body) {
  const existing = db.prepare('SELECT * FROM breeding_records WHERE id = ? AND farm_id = ?').get(id, FARM_ID);
  if (!existing) throw new HttpError(404, 'Breeding record not found.');

  const data = validateRecord(body);
  assertAnimal(data.animal_id);

  db.prepare(
    `UPDATE breeding_records SET
       animal_id = ?, heat_date = ?, service_date = ?, service_method = ?, sire_info = ?,
       pregnancy_check_date = ?, pregnancy_result = ?, expected_calving_date = ?, expected_calving_estimated = ?,
       actual_calving_date = ?, calving_outcome = ?, offspring_count = ?, notes = ?,
       updated_at = datetime('now')
     WHERE id = ? AND farm_id = ?`
  ).run(
    data.animal_id,
    data.heat_date,
    data.service_date,
    data.service_method,
    data.sire_info,
    data.pregnancy_check_date,
    data.pregnancy_result,
    data.expected_calving_date,
    data.expected_calving_estimated,
    data.actual_calving_date,
    data.calving_outcome,
    data.offspring_count,
    data.notes,
    id,
    FARM_ID
  );

  return get(id);
}

function remove(id) {
  const info = db.prepare('DELETE FROM breeding_records WHERE id = ? AND farm_id = ?').run(id, FARM_ID);
  if (info.changes === 0) throw new HttpError(404, 'Breeding record not found.');
  return { ok: true };
}

module.exports = { list, summary, get, currentForAnimal, create, update, remove };

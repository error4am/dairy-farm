const db = require('../db');
const { FARM_ID } = require('../config');
const { HttpError } = require('../middleware/errors');
const { ALERT_STATUSES } = require('../constants/enums');
const { todayLocal, addDays, parseLocal } = require('../utils/date');

const PREGNANCY_CHECK_WINDOW_DAYS = 7;
const DUE_WINDOW_DAYS = 1;
const WITHDRAWAL_WINDOW_DAYS = 1;
const AUTO_RUN_INTERVAL_MS = 30000;

function clampLimit(value, fallback = 25, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function trimNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function animalLabel(animalType, tagNumber) {
  const kind = animalType === 'cow' ? 'Cow' : animalType === 'buffalo' ? 'Buffalo' : 'Animal';
  return `${kind} #${tagNumber}`;
}

function diffDays(from, to) {
  return Math.round((parseLocal(to) - parseLocal(from)) / 86400000);
}

function duePhrase(dueDate, today) {
  const days = diffDays(today, dueDate);
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days < 0) return `overdue (was due ${dueDate})`;
  return `due on ${dueDate}`;
}

function calvingPhrase(daysLeft, expectedDate) {
  if (daysLeft === 0) return 'is expected to calve today';
  if (daysLeft === 1) return 'is expected to calve tomorrow';
  if (daysLeft < 0) return `is overdue for calving (expected ${expectedDate})`;
  return `is expected to calve in ${daysLeft} days`;
}

function withdrawalPhrase(withdrawalUntil, today) {
  const days = diffDays(today, withdrawalUntil);
  if (days === 0) return 'ends today';
  if (days === 1) return 'ends tomorrow';
  return `ends on ${withdrawalUntil}`;
}

async function detectBreedingAlerts(today) {
  const entries = [];

  const pendingChecks = await db.all(
    `SELECT b.id, b.pregnancy_check_date, a.tag_number, a.type AS animal_type
       FROM breeding_records b
       JOIN animals a ON a.id = b.animal_id
      WHERE b.farm_id = ? AND b.pregnancy_result = 'pending' AND b.service_date IS NOT NULL`,
    [FARM_ID]
  );
  for (const row of pendingChecks) {
    const checkDate = row.pregnancy_check_date;
    if (checkDate && checkDate > addDays(today, PREGNANCY_CHECK_WINDOW_DAYS)) continue;
    const label = animalLabel(row.animal_type, row.tag_number);
    entries.push({
      type: 'pregnancy_check',
      severity: 'warning',
      title: 'Pregnancy check due',
      message:
        !checkDate || checkDate <= today
          ? `${label} needs a pregnancy check.`
          : `${label} pregnancy check is due on ${checkDate}.`,
      source_type: 'breeding',
      source_id: row.id,
      trigger_key: `pregnancy_check:breeding:${row.id}:${checkDate || 'none'}`
    });
  }

  const calving = await db.all(
    `SELECT b.id, b.expected_calving_date, a.tag_number, a.type AS animal_type
       FROM breeding_records b
       JOIN animals a ON a.id = b.animal_id
      WHERE b.farm_id = ? AND b.pregnancy_result = 'pregnant'
        AND b.actual_calving_date IS NULL
        AND b.expected_calving_date IS NOT NULL`,
    [FARM_ID]
  );
  for (const row of calving) {
    const daysLeft = diffDays(today, row.expected_calving_date);
    let stage = null;
    let severity = 'warning';
    if (daysLeft <= 0) {
      stage = 'due';
      severity = 'critical';
    } else if (daysLeft <= 3) {
      stage = '3d';
    } else if (daysLeft <= 7) {
      stage = '7d';
    } else {
      continue;
    }
    const label = animalLabel(row.animal_type, row.tag_number);
    entries.push({
      type: 'calving',
      severity,
      title: stage === 'due' ? 'Calving due' : 'Calving approaching',
      message: `${label} ${calvingPhrase(daysLeft, row.expected_calving_date)}.`,
      source_type: 'breeding',
      source_id: row.id,
      trigger_key: `calving:breeding:${row.id}:${stage}`
    });
  }

  return entries;
}

async function detectHealthAlerts(today) {
  const entries = [];

  const due = await db.all(
    `SELECT h.id, h.type, h.next_due_date, a.tag_number, a.type AS animal_type
       FROM health_records h
       JOIN animals a ON a.id = h.animal_id
      WHERE h.farm_id = ? AND h.next_due_date IS NOT NULL AND h.next_due_date <= ?`,
    [FARM_ID, addDays(today, DUE_WINDOW_DAYS)]
  );
  for (const row of due) {
    const label = animalLabel(row.animal_type, row.tag_number);
    const overdue = row.next_due_date < today;
    if (row.type === 'vaccination') {
      entries.push({
        type: 'vaccination',
        severity: 'warning',
        title: 'Vaccination due',
        message: overdue
          ? `${label} vaccination is overdue (was due ${row.next_due_date}).`
          : `${label} vaccination is ${duePhrase(row.next_due_date, today)}.`,
        source_type: 'health',
        source_id: row.id,
        trigger_key: `vaccination:health:${row.id}:${row.next_due_date}`
      });
    } else {
      entries.push({
        type: 'treatment_followup',
        severity: 'warning',
        title: 'Treatment follow-up due',
        message: overdue
          ? `${label} health follow-up is overdue (was due ${row.next_due_date}).`
          : `${label} has a health follow-up ${duePhrase(row.next_due_date, today)}.`,
        source_type: 'health',
        source_id: row.id,
        trigger_key: `treatment:health:${row.id}:${row.next_due_date}`
      });
    }
  }

  const withdrawals = await db.all(
    `SELECT h.id, h.withdrawal_until, a.tag_number, a.type AS animal_type
       FROM health_records h
       JOIN animals a ON a.id = h.animal_id
      WHERE h.farm_id = ? AND h.withdrawal_until IS NOT NULL
        AND h.withdrawal_until >= ? AND h.withdrawal_until <= ?`,
    [FARM_ID, today, addDays(today, WITHDRAWAL_WINDOW_DAYS)]
  );
  for (const row of withdrawals) {
    const label = animalLabel(row.animal_type, row.tag_number);
    entries.push({
      type: 'milk_withdrawal',
      severity: 'info',
      title: 'Milk withdrawal ending',
      message: `${label} milk withdrawal ${withdrawalPhrase(row.withdrawal_until, today)}.`,
      source_type: 'health',
      source_id: row.id,
      trigger_key: `withdrawal:health:${row.id}:${row.withdrawal_until}`
    });
  }

  return entries;
}

function episodeStart(steps, isAbove) {
  let lastAbove = -1;
  for (let i = 0; i < steps.length; i++) {
    if (isAbove(steps[i].stock)) lastAbove = i;
  }
  const next = steps[lastAbove + 1];
  return next ? next.id : 0;
}

async function detectInventoryAlerts() {
  const items = await db.all(
    'SELECT id, name, unit, minimum_stock FROM inventory_items WHERE farm_id = ? AND active = 1',
    [FARM_ID]
  );
  if (items.length === 0) return [];

  const movements = await db.all(
    'SELECT item_id, id, quantity FROM inventory_movements WHERE farm_id = ? ORDER BY item_id ASC, id ASC',
    [FARM_ID]
  );
  const byItem = new Map();
  for (const movement of movements) {
    if (!byItem.has(movement.item_id)) byItem.set(movement.item_id, []);
    byItem.get(movement.item_id).push(movement);
  }

  const entries = [];
  for (const item of items) {
    const itemMovements = byItem.get(item.id) || [];
    let stock = 0;
    const steps = [];
    for (const movement of itemMovements) {
      stock = Math.round((stock + movement.quantity) * 1000) / 1000;
      steps.push({ id: movement.id, stock });
    }

    if (stock <= 0) {
      entries.push({
        type: 'out_of_stock',
        severity: 'critical',
        title: 'Out of stock',
        message: `${item.name} is out of stock.`,
        source_type: 'inventory_item',
        source_id: item.id,
        trigger_key: `out_stock:inventory_item:${item.id}:${episodeStart(steps, (s) => s > 0)}`
      });
    } else if (item.minimum_stock !== null && stock <= item.minimum_stock) {
      entries.push({
        type: 'low_stock',
        severity: 'warning',
        title: 'Low stock',
        message: `${item.name} has ${trimNumber(stock)} ${item.unit} remaining.`,
        source_type: 'inventory_item',
        source_id: item.id,
        trigger_key: `low_stock:inventory_item:${item.id}:${episodeStart(steps, (s) => s > item.minimum_stock)}`
      });
    }
  }
  return entries;
}

async function detectActiveAlerts(today) {
  return [
    ...(await detectBreedingAlerts(today)),
    ...(await detectHealthAlerts(today)),
    ...(await detectInventoryAlerts())
  ];
}

let activeRun = null;
let lastAutoRunAt = 0;

async function doRun() {
  const today = todayLocal();
  const active = await detectActiveAlerts(today);
  const activeKeys = new Set(active.map((entry) => entry.trigger_key));

  const existing = await db.all(
    "SELECT id, trigger_key FROM alerts WHERE farm_id = ? AND status != 'resolved'",
    [FARM_ID]
  );
  const staleIds = existing.filter((row) => !activeKeys.has(row.trigger_key)).map((row) => row.id);

  let resolved = 0;
  if (staleIds.length > 0) {
    const placeholders = staleIds.map(() => '?').join(',');
    const info = await db.run(
      `UPDATE alerts SET status = 'resolved', resolved_at = ?
        WHERE farm_id = ? AND status != 'resolved' AND id IN (${placeholders})`,
      [db.now(), FARM_ID, ...staleIds]
    );
    resolved = (info && info.changes) || 0;
  }

  let created = 0;
  for (const entry of active) {
    const found = await db.get('SELECT id FROM alerts WHERE farm_id = ? AND trigger_key = ?', [
      FARM_ID,
      entry.trigger_key
    ]);
    if (found) continue;
    try {
      await db.run(
        `INSERT INTO alerts
           (farm_id, type, severity, title, message, source_type, source_id, trigger_key, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?)`,
        [
          FARM_ID,
          entry.type,
          entry.severity,
          entry.title,
          entry.message,
          entry.source_type,
          entry.source_id,
          entry.trigger_key,
          db.now()
        ]
      );
      created += 1;
    } catch (err) {
      if (db.isUniqueViolation(err)) continue;
      throw err;
    }
  }

  const unread = (
    await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM alerts WHERE farm_id = ? AND status = 'unread'", [
      FARM_ID
    ])
  ).n;

  return { created, resolved, active: active.length, unread };
}

async function runAlertEngine() {
  if (activeRun) return activeRun;
  activeRun = doRun().finally(() => {
    activeRun = null;
  });
  return activeRun;
}

async function maybeRunAlertEngine() {
  const now = Date.now();
  if (now - lastAutoRunAt < AUTO_RUN_INTERVAL_MS) return null;
  lastAutoRunAt = now;
  try {
    return await runAlertEngine();
  } catch (err) {
    lastAutoRunAt = 0;
    console.error(`Alert engine failed: ${err.message}`);
    return null;
  }
}

async function get(id) {
  const row = await db.get('SELECT * FROM alerts WHERE id = ? AND farm_id = ?', [id, FARM_ID]);
  if (!row) throw new HttpError(404, 'Alert not found.');
  return row;
}

async function list(query = {}) {
  const status = query.status || 'all';
  const where = ['farm_id = ?'];
  const params = [FARM_ID];

  if (status === 'active') {
    where.push("status != 'resolved'");
  } else if (status !== 'all') {
    if (!ALERT_STATUSES.includes(status)) {
      throw new HttpError(400, 'Please check the highlighted fields.', {
        status: 'Unknown alert status filter.'
      });
    }
    where.push('status = ?');
    params.push(status);
  }

  const whereSql = where.join(' AND ');
  const total = (await db.get(`SELECT CAST(COUNT(*) AS INTEGER) AS n FROM alerts WHERE ${whereSql}`, params)).n;
  const limit = clampLimit(query.limit);
  const offset = Math.max(0, Number(query.offset) || 0);
  const items = await db.all(
    `SELECT * FROM alerts WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { items, total, limit, offset };
}

async function unreadCount() {
  const row = await db.get(
    "SELECT CAST(COUNT(*) AS INTEGER) AS n FROM alerts WHERE farm_id = ? AND status = 'unread'",
    [FARM_ID]
  );
  return row.n;
}

async function markRead(id) {
  const row = await get(id);
  if (row.status !== 'unread') return row;
  await db.run('UPDATE alerts SET status = ?, read_at = ? WHERE id = ? AND farm_id = ?', [
    'read',
    db.now(),
    id,
    FARM_ID
  ]);
  return get(id);
}

async function resolve(id) {
  const row = await get(id);
  if (row.status === 'resolved') return row;
  await db.run('UPDATE alerts SET status = ?, resolved_at = ? WHERE id = ? AND farm_id = ?', [
    'resolved',
    db.now(),
    id,
    FARM_ID
  ]);
  return get(id);
}

module.exports = {
  runAlertEngine,
  maybeRunAlertEngine,
  list,
  unreadCount,
  markRead,
  resolve,
  get
};

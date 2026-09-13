const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const testRoot = path.join(os.tmpdir(), `dairy-backup-test-${process.pid}-${Date.now()}`);
const dataDir = path.join(testRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });

process.env.DB_PATH = path.join(dataDir, 'dairy.db');
process.env.BACKUP_DIR = path.join(testRoot, 'backups');

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

require('../db/seed')();

const db = require('../db/connection');
const animalService = require('../services/animalService');
const milkService = require('../services/milkService');
const financeService = require('../services/financeService');
const healthService = require('../services/healthService');
const breedingService = require('../services/breedingService');
const employeeService = require('../services/employeeService');
const paymentService = require('../services/paymentService');
const dashboardService = require('../services/dashboardService');
const backup = require('../db/backup');
const { restoreFromBackup } = require('../db/restore');
const { validateBackupFile, rotateAutomaticBackups } = require('../db/backupUtils');
const { todayLocal, addDays } = require('../utils/date');

const today = todayLocal();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function withServer(dbPath, fn) {
  const port = await freePort();
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      BACKUP_DIR: path.join(testRoot, `child-backups-${port}`),
      HOST: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.resume();

  const ready = await waitForHealth(port);
  if (!ready) {
    child.kill();
    throw new Error(`server did not start for ${dbPath}: ${stderr}`);
  }

  try {
    return await fn(`http://127.0.0.1:${port}/api`);
  } finally {
    child.kill();
    await once(child, 'exit').catch(() => {});
  }
}

function openReadonly(file) {
  return new Database(file, { readonly: true, fileMustExist: true });
}

let backupPath = null;

test('creates a valid, self-contained backup of the active database', () => {
  const bella = animalService.create({ tag_number: 'B-1', name: 'Bella', type: 'cow', gender: 'female' });
  milkService.create({ animal_id: bella.id, date: today, session: 'morning', quantity: 12.5, unit: 'L' });
  milkService.create({ animal_id: bella.id, date: today, session: 'evening', quantity: 10, unit: 'L' });
  financeService.create({ date: today, type: 'income', category: 'milk_sale', amount: 5000, description: 'Milk sale' });
  financeService.create({ date: today, type: 'expense', category: 'feed', amount: 1500, description: 'Fodder' });
  healthService.create({
    animal_id: bella.id,
    date: today,
    type: 'treatment',
    condition: 'Mastitis',
    medicine: 'Amoxicillin',
    cost: 4000
  });
  breedingService.create({
    animal_id: bella.id,
    heat_date: addDays(today, -20),
    service_date: addDays(today, -18),
    service_method: 'artificial_insemination',
    pregnancy_check_date: addDays(today, -2),
    pregnancy_result: 'pregnant',
    expected_calving_date: addDays(today, 265),
    expected_calving_estimated: 1
  });
  const employee = employeeService.create({
    name: 'Ali',
    role: 'Milker',
    joining_date: addDays(today, -100),
    status: 'active',
    pay_type: 'monthly',
    salary: 35000
  });
  paymentService.create({ employee_id: employee.id, date: today, type: 'salary', amount: 35000, description: 'Salary' });

  backupPath = path.join(testRoot, 'manual', 'snapshot.db');
  backup.createBackup(backupPath);

  assert.ok(fs.existsSync(backupPath), 'backup file exists');
  assert.ok(!fs.existsSync(backupPath + '.tmp'), 'no partial file is left behind');
  validateBackupFile(backupPath);

  const probe = openReadonly(backupPath);
  assert.equal(probe.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM animals').get().n, 1);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM milk_records').get().n, 2);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM health_records').get().n, 1);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM breeding_records').get().n, 1);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 1);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM employee_payments').get().n, 1);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 4);
  probe.close();

  const totals = financeService.totals();
  assert.equal(totals.income, 5000);
  assert.equal(totals.expenses, 40500);
  assert.equal(totals.net, totals.income - totals.expenses);
});

test('backup is a point-in-time snapshot and does not interrupt usage', () => {
  const extra = animalService.create({ tag_number: 'B-2', type: 'buffalo', gender: 'female' });
  milkService.create({ animal_id: extra.id, date: today, session: 'morning', quantity: 5, unit: 'L' });
  financeService.create({ date: today, type: 'expense', category: 'electricity', amount: 777, description: 'Post-backup' });

  assert.equal(financeService.totals().expenses, 40500 + 777, 'active database remains fully usable');

  const probe = openReadonly(backupPath);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM animals').get().n, 1, 'post-backup animal is absent from the backup');
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM milk_records').get().n, 2);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 4);
  probe.close();
});

test('full restore preserves data, excludes post-backup records, and keeps relationships', async () => {
  const restoredDb = path.join(testRoot, 'restored', 'restored.db');
  const result = restoreFromBackup(backupPath, {
    dbPath: restoredDb,
    backupDir: path.join(testRoot, 'restored', 'safety')
  });

  assert.equal(result.safetyBackup, null, 'no safety backup needed when the target does not exist');
  validateBackupFile(restoredDb);

  const probe = openReadonly(restoredDb);
  assert.equal(probe.pragma('foreign_key_check').length, 0, 'no foreign key violations');

  const bella = probe.prepare("SELECT * FROM animals WHERE tag_number = 'B-1'").get();
  assert.ok(bella, 'pre-backup animal restored');
  assert.equal(
    probe.prepare("SELECT COUNT(*) AS n FROM animals WHERE tag_number = 'B-2'").get().n,
    0,
    'post-backup animal excluded'
  );

  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM milk_records WHERE animal_id = ?').get(bella.id).n, 2);

  const health = probe.prepare('SELECT * FROM health_records WHERE animal_id = ?').get(bella.id);
  assert.ok(health, 'health record restored');
  assert.ok(health.transaction_id, 'health record keeps its linked transaction');
  const healthTx = probe.prepare('SELECT * FROM transactions WHERE id = ?').get(health.transaction_id);
  assert.equal(healthTx.category, 'medicine');
  assert.equal(healthTx.amount, 4000);

  const breeding = probe.prepare('SELECT * FROM breeding_records WHERE animal_id = ?').get(bella.id);
  assert.ok(breeding, 'breeding record restored');
  assert.equal(breeding.pregnancy_result, 'pregnant');

  const payment = probe.prepare('SELECT * FROM employee_payments LIMIT 1').get();
  assert.ok(payment, 'employee payment restored');
  assert.ok(payment.transaction_id, 'payment keeps its linked transaction');
  const paymentTx = probe.prepare('SELECT * FROM transactions WHERE id = ?').get(payment.transaction_id);
  assert.equal(paymentTx.category, 'labor');
  assert.equal(paymentTx.amount, 35000);

  const income = probe.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM transactions WHERE type = 'income'").get().t;
  const expenses = probe.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM transactions WHERE type = 'expense'").get().t;
  assert.equal(income, 5000, 'finance income preserved');
  assert.equal(expenses, 40500, 'finance expenses preserved');
  assert.equal(income - expenses, -35500, 'net profit preserved');

  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 4);
  probe.close();

  await withServer(restoredDb, async (base) => {
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.status, 'ok');

    const dashboard = await (await fetch(base + '/dashboard')).json();
    assert.equal(dashboard.metrics.active_animals, 1);
    assert.equal(dashboard.metrics.milk_today, 22.5);
    assert.equal(dashboard.metrics.revenue_all_time, 5000);
    assert.equal(dashboard.metrics.expenses_all_time, 40500);
    assert.equal(dashboard.metrics.net_all_time, -35500);
    assert.equal(dashboard.metrics.employees.active_count, 1);
    assert.equal(dashboard.metrics.employees.labor_cost_this_month, 35000);
    assert.equal(dashboard.metrics.breeding.currently_pregnant, 1);

    assert.equal((await (await fetch(base + '/animals')).json()).length, 1);
    assert.equal((await (await fetch(base + '/health-records')).json()).total, 1);
    assert.equal((await (await fetch(base + '/breeding-records')).json()).total, 1);
    assert.equal((await (await fetch(base + '/employees')).json()).length, 1);
    assert.equal((await (await fetch(base + '/employee-payments')).json()).total, 1);
  });
});

test('restore creates a safety backup before replacing an existing database', () => {
  const target = path.join(testRoot, 'replace', 'target.db');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const marker = new Database(target);
  marker.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_init.sql'), 'utf8'));
  marker.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
  );
  marker.prepare("INSERT INTO schema_migrations (name) VALUES ('001_init.sql')").run();
  marker
    .prepare("INSERT INTO farms (id, name, currency, milk_unit, week_start) VALUES (1, 'Marker Farm', 'PKR', 'L', 'monday')")
    .run();
  marker
    .prepare("INSERT INTO animals (farm_id, tag_number, type, gender, status) VALUES (1, 'MARKER', 'cow', 'female', 'active')")
    .run();
  marker.close();

  const result = restoreFromBackup(backupPath, { dbPath: target, backupDir: path.join(testRoot, 'safety') });

  assert.ok(result.safetyBackup, 'safety backup path returned');
  assert.ok(fs.existsSync(result.safetyBackup), 'safety backup exists');
  validateBackupFile(result.safetyBackup);

  const safety = openReadonly(result.safetyBackup);
  assert.ok(safety.prepare("SELECT * FROM animals WHERE tag_number = 'MARKER'").get(), 'safety backup holds the replaced database');
  safety.close();

  const replaced = openReadonly(target);
  assert.equal(replaced.prepare("SELECT COUNT(*) AS n FROM animals WHERE tag_number = 'MARKER'").get().n, 0);
  assert.ok(replaced.prepare("SELECT * FROM animals WHERE tag_number = 'B-1'").get(), 'target now holds the restored backup');
  replaced.close();
});

test('restored older-schema database migrates on startup with data intact', async () => {
  const oldDir = path.join(testRoot, 'old');
  fs.mkdirSync(oldDir, { recursive: true });
  const oldDb = path.join(oldDir, 'old.db');

  const old = new Database(oldDb);
  old.pragma('journal_mode = WAL');
  old.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_init.sql'), 'utf8'));
  old.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
  );
  old.prepare("INSERT INTO schema_migrations (name) VALUES ('001_init.sql')").run();
  old.prepare("INSERT INTO farms (id, name, currency, milk_unit, week_start) VALUES (1, 'Old Farm', 'PKR', 'L', 'monday')").run();
  old
    .prepare("INSERT INTO animals (farm_id, tag_number, type, gender, status) VALUES (1, 'OLD-1', 'cow', 'female', 'active')")
    .run();
  old.close();

  const oldBackup = path.join(oldDir, 'old-backup.db');
  const source = new Database(oldDb, { readonly: true });
  source.exec(`VACUUM INTO '${oldBackup.replace(/'/g, "''")}'`);
  source.close();
  validateBackupFile(oldBackup);

  const restoredOld = path.join(oldDir, 'restored-old.db');
  restoreFromBackup(oldBackup, { dbPath: restoredOld, backupDir: path.join(oldDir, 'safety') });

  await withServer(restoredOld, async (base) => {
    const animals = await (await fetch(base + '/animals')).json();
    assert.equal(animals.length, 1);
    assert.equal(animals[0].tag_number, 'OLD-1');

    const health = await (await fetch(base + '/health-records/summary')).json();
    assert.equal(health.withdrawal_count, 0);

    const employees = await (await fetch(base + '/employees/summary')).json();
    assert.equal(employees.active_count, 0);

    const settings = await (await fetch(base + '/settings')).json();
    assert.equal(settings.gestation_days, 283, 'new column added by migration with default');
  });

  const probe = openReadonly(restoredOld);
  assert.equal(probe.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 4, 'all migrations applied');
  assert.ok(probe.prepare("SELECT * FROM animals WHERE tag_number = 'OLD-1'").get(), 'old data intact after migration');
  probe.close();
});

test('manual backup endpoint returns a verified SQLite file', async () => {
  const app = require('../index');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/settings/backup`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /attachment/);

    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.length > 0, 'response is not empty');

    const downloaded = path.join(testRoot, 'downloaded.db');
    fs.writeFileSync(downloaded, bytes);
    validateBackupFile(downloaded);

    const probe = openReadonly(downloaded);
    assert.ok(probe.prepare('SELECT COUNT(*) AS n FROM animals').get().n >= 1);
    probe.close();
  } finally {
    server.close();
    await once(server, 'close').catch(() => {});
  }
});

test('automatic backup runs at most once per day and rotates to the latest 30', () => {
  const autoDir = path.join(testRoot, 'auto');
  fs.mkdirSync(autoDir, { recursive: true });

  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(autoDir, `dairy-${addDays(today, -60 + i)}.db`), 'older placeholder');
  }

  const first = backup.runAutomaticBackup({ dir: autoDir });
  assert.equal(first.skipped, false, 'first run creates a backup');
  assert.ok(fs.existsSync(first.path));
  validateBackupFile(first.path);
  assert.equal(first.removed.length, 1, 'oldest automatic backup rotated out');
  assert.ok(!fs.existsSync(path.join(autoDir, `dairy-${addDays(today, -60)}.db`)));

  const remaining = fs.readdirSync(autoDir).filter((f) => /^dairy-\d{4}-\d{2}-\d{2}\.db$/.test(f));
  assert.equal(remaining.length, 30);

  const second = backup.runAutomaticBackup({ dir: autoDir });
  assert.equal(second.skipped, true, 'second run on the same day is skipped');
  assert.equal(second.reason, 'already-backed-up-today');
  assert.equal(fs.readdirSync(autoDir).filter((f) => /^dairy-\d{4}-\d{2}-\d{2}\.db$/.test(f)).length, 30);
});

test('rotation never touches manual backups, safety backups or unrelated files', () => {
  const dir = path.join(testRoot, 'rotate');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manual-backup-2026-01-01.db'), 'manual');
  fs.writeFileSync(path.join(dir, 'pre-restore-2026-01-01_120000.db'), 'safety');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(dir, 'dairy-2026-01-01.db'), 'auto');
  fs.writeFileSync(path.join(dir, 'dairy-2026-01-02.db'), 'auto');

  rotateAutomaticBackups(dir, 1);

  assert.ok(fs.existsSync(path.join(dir, 'manual-backup-2026-01-01.db')));
  assert.ok(fs.existsSync(path.join(dir, 'pre-restore-2026-01-01_120000.db')));
  assert.ok(fs.existsSync(path.join(dir, 'notes.txt')));
  assert.ok(!fs.existsSync(path.join(dir, 'dairy-2026-01-01.db')), 'oldest automatic backup removed');
  assert.ok(fs.existsSync(path.join(dir, 'dairy-2026-01-02.db')));
  assert.ok(fs.existsSync(process.env.DB_PATH), 'active database untouched by rotation');
});

after(() => {
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

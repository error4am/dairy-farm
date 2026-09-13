const os = require('os');
const fs = require('fs');
const path = require('path');

const testRoot = path.join(os.tmpdir(), `dairy-backup-failures-${process.pid}-${Date.now()}`);
fs.mkdirSync(path.join(testRoot, 'data'), { recursive: true });

process.env.DB_PATH = path.join(testRoot, 'data', 'dairy.db');
process.env.BACKUP_DIR = path.join(testRoot, 'backups');

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

require('../db/seed')();

const db = require('../db/connection');
const backup = require('../db/backup');
const { restoreFromBackup } = require('../db/restore');
const { validateBackupFile, BackupError } = require('../db/backupUtils');

test('fails clearly when the backup path cannot be created', () => {
  const blocker = path.join(testRoot, 'blocker');
  fs.writeFileSync(blocker, 'not a directory');

  assert.throws(
    () => backup.createBackup(path.join(blocker, 'nested', 'backup.db')),
    (err) => err instanceof BackupError && /Backup creation failed/i.test(err.message),
    'path failure surfaces as a clear backup error'
  );

  assert.throws(
    () => backup.runAutomaticBackup({ dir: path.join(blocker, 'auto') }),
    (err) => err instanceof BackupError && /Backup creation failed/i.test(err.message),
    'automatic backup path failure surfaces as a clear backup error'
  );
});

test('fails clearly when the backup target cannot be staged', () => {
  const target = path.join(testRoot, 'staged', 'backup.db');
  fs.mkdirSync(path.join(target + '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(target + '.tmp', 'leftover.txt'), 'partial');

  assert.throws(
    () => backup.createBackup(target),
    (err) => err instanceof BackupError && /Backup creation failed/i.test(err.message),
    'staging failure is reported'
  );
  assert.ok(!fs.existsSync(target), 'no target file is produced on failure');
});

test('rejects an empty file as a backup', () => {
  const empty = path.join(testRoot, 'empty.db');
  fs.writeFileSync(empty, '');

  assert.throws(() => validateBackupFile(empty), (err) => err instanceof BackupError && /empty/i.test(err.message));

  assert.throws(
    () => restoreFromBackup(empty, { dbPath: path.join(testRoot, 'x', 'target.db'), backupDir: path.join(testRoot, 'safety') }),
    (err) => err instanceof BackupError && /empty/i.test(err.message),
    'restore refuses an empty file'
  );
});

test('rejects a non-SQLite file as a backup', () => {
  const text = path.join(testRoot, 'not-a-db.db');
  fs.writeFileSync(text, 'hello, this is not a database');

  assert.throws(
    () => validateBackupFile(text),
    (err) => err instanceof BackupError && /not a valid SQLite database/i.test(err.message)
  );
});

test('rejects a corrupt SQLite file as a backup', () => {
  const corrupt = path.join(testRoot, 'corrupt.db');
  const bytes = Buffer.alloc(4096);
  bytes.write('SQLite format 3\0', 0, 'utf8');
  bytes.write('garbage data that is not a valid sqlite page', 16, 'utf8');
  fs.writeFileSync(corrupt, bytes);

  assert.throws(
    () => validateBackupFile(corrupt),
    (err) => err instanceof BackupError && /could not be opened|integrity/i.test(err.message),
    'corrupt file is rejected with a clear error'
  );
});

test('restore failure leaves the target database untouched', () => {
  const target = path.join(testRoot, 'target', 'keep.db');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const marker = new Database(target);
  marker.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, name TEXT)');
  marker.prepare('INSERT INTO marker (name) VALUES (?)').run('keep-me');
  marker.close();

  const bad = path.join(testRoot, 'bad.db');
  fs.writeFileSync(bad, 'not a database');

  assert.throws(
    () => restoreFromBackup(bad, { dbPath: target, backupDir: path.join(testRoot, 'safety') }),
    (err) => err instanceof BackupError && /not a valid SQLite database/i.test(err.message)
  );

  const probe = new Database(target, { readonly: true });
  assert.equal(probe.prepare('SELECT name FROM marker').get().name, 'keep-me', 'original database is intact');
  probe.close();

  assert.equal(
    fs.existsSync(path.join(testRoot, 'safety')),
    false,
    'no safety backup is created when the source is rejected'
  );
});

test('restore refuses to overwrite the database with itself', () => {
  const file = path.join(testRoot, 'self.db');
  backup.createBackup(file);

  assert.throws(
    () => restoreFromBackup(file, { dbPath: file, backupDir: path.join(testRoot, 'safety') }),
    (err) => err instanceof BackupError && /same file/i.test(err.message)
  );
});

test('a stale partial backup file is replaced on the next attempt', () => {
  const target = path.join(testRoot, 'stale', 'backup.db');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + '.tmp', 'stale partial data');

  backup.createBackup(target);

  validateBackupFile(target);
  assert.ok(!fs.existsSync(target + '.tmp'), 'stale partial file is removed');
});

test('overwrites an existing backup with the same filename and stays valid', () => {
  const target = path.join(testRoot, 'overwrite', 'backup.db');

  backup.createBackup(target);
  validateBackupFile(target);

  backup.createBackup(target);
  validateBackupFile(target);
});

after(() => {
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

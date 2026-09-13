const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_PATH, BACKUP_DIR } = require('../config');
const { BackupError, validateBackupFile } = require('./backupUtils');

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

function createSafetyBackup(dbPath, backupDir) {
  if (!fs.existsSync(dbPath)) return null;

  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `pre-restore-${timestamp()}.db`);
  const tmp = `${target}.tmp`;
  fs.rmSync(tmp, { force: true });

  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    source.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }

  try {
    validateBackupFile(tmp);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new BackupError(`Could not create a safety backup before restoring: ${err.message}`);
  }

  fs.renameSync(tmp, target);
  return target;
}

function restoreFromBackup(backupPath, options = {}) {
  const targetDb = options.dbPath || DB_PATH;
  const backupDir = options.backupDir || BACKUP_DIR;

  if (!backupPath) throw new BackupError('No backup file specified.');
  const source = path.resolve(backupPath);

  if (source === path.resolve(targetDb)) {
    throw new BackupError('The backup file and the active database are the same file.');
  }

  validateBackupFile(source);

  const safetyBackup = createSafetyBackup(targetDb, backupDir);

  const staged = `${targetDb}.restore`;
  try {
    fs.mkdirSync(path.dirname(targetDb), { recursive: true });
    fs.copyFileSync(source, staged);
    validateBackupFile(staged);
  } catch (err) {
    fs.rmSync(staged, { force: true });
    if (err instanceof BackupError) throw err;
    throw new BackupError(`Restore failed while staging the backup: ${err.message}`);
  }

  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(targetDb + suffix, { force: true });
  }
  fs.renameSync(staged, targetDb);

  return { dbPath: targetDb, restoredFrom: source, safetyBackup };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run db:restore -w server -- <path-to-backup.db>');
    console.error('Stop the application before restoring.');
    process.exit(1);
  }
  try {
    const result = restoreFromBackup(file);
    console.log(`Database restored from: ${result.restoredFrom}`);
    console.log(`Active database: ${result.dbPath}`);
    if (result.safetyBackup) {
      console.log(`Safety backup of the previous database: ${result.safetyBackup}`);
    }
    console.log('Start the application to run any pending migrations.');
  } catch (err) {
    console.error(`Restore failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { restoreFromBackup, createSafetyBackup };

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class BackupError extends Error {}

const AUTO_BACKUP_PATTERN = /^dairy-\d{4}-\d{2}-\d{2}\.db$/;
const REQUIRED_TABLES = ['schema_migrations', 'farms', 'animals', 'milk_records', 'transactions'];

function validateBackupFile(filePath) {
  if (!filePath) throw new BackupError('No backup file specified.');
  if (!fs.existsSync(filePath)) throw new BackupError('Backup file was not created.');
  if (!fs.statSync(filePath).isFile()) throw new BackupError('Backup path is not a file.');
  if (fs.statSync(filePath).size === 0) throw new BackupError('Backup file is empty.');

  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
      throw new BackupError('Backup file is not a valid SQLite database.');
    }
  } finally {
    fs.closeSync(fd);
  }

  let probe = null;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = probe.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new BackupError(`Backup failed the SQLite integrity check: ${integrity}`);
    }
    const tables = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    const missing = REQUIRED_TABLES.filter((table) => !tables.includes(table));
    if (missing.length > 0) {
      throw new BackupError(`Backup is missing expected tables: ${missing.join(', ')}`);
    }
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('Backup file could not be opened as a SQLite database.');
  } finally {
    if (probe) probe.close();
  }

  return true;
}

function autoBackupFilename(dateStr) {
  return `dairy-${dateStr}.db`;
}

function isAutoBackupFile(name) {
  return AUTO_BACKUP_PATTERN.test(name);
}

function rotateAutomaticBackups(dir, keep = 30) {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter(isAutoBackupFile)
    .sort()
    .reverse();
  const removed = [];
  for (const name of files.slice(keep)) {
    fs.rmSync(path.join(dir, name), { force: true });
    removed.push(name);
  }
  return removed;
}

module.exports = {
  BackupError,
  validateBackupFile,
  autoBackupFilename,
  isAutoBackupFile,
  rotateAutomaticBackups,
  AUTO_BACKUP_PATTERN,
  REQUIRED_TABLES
};

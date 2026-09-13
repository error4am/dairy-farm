const fs = require('fs');
const path = require('path');
const db = require('./connection');
const { BACKUP_DIR } = require('../config');
const { todayLocal } = require('../utils/date');
const { BackupError, validateBackupFile, autoBackupFilename, rotateAutomaticBackups } = require('./backupUtils');

function createBackup(targetPath) {
  if (!targetPath) throw new BackupError('No backup target specified.');

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  } catch (err) {
    throw new BackupError(`Backup creation failed: ${err.message}`);
  }

  const tmpPath = `${targetPath}.tmp`;
  try {
    fs.rmSync(tmpPath, { force: true });
  } catch (err) {
    throw new BackupError(`Backup creation failed: ${err.message}`);
  }

  try {
    db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw new BackupError(`Backup creation failed: ${err.message}`);
  }

  try {
    validateBackupFile(tmpPath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }

  fs.renameSync(tmpPath, targetPath);
  return targetPath;
}

function runAutomaticBackup(options = {}) {
  const dir = options.dir || BACKUP_DIR;
  const date = todayLocal();
  const target = path.join(dir, autoBackupFilename(date));

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new BackupError(`Backup creation failed: ${err.message}`);
  }

  if (fs.existsSync(target)) {
    return { skipped: true, reason: 'already-backed-up-today', date, path: target, removed: [] };
  }

  createBackup(target);
  const removed = rotateAutomaticBackups(dir, options.keep || 30);
  return { skipped: false, date, path: target, removed };
}

module.exports = { createBackup, runAutomaticBackup };

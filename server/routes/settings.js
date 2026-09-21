const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const service = require('../services/settingsService');
const db = require('../db');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => res.json(await service.get())));
router.put('/', asyncHandler(async (req, res) => res.json(await service.update(req.body))));

router.get('/backup', (req, res) => {
  if (db.isPostgres) {
    return res.status(501).json({ error: 'Backups are available in the desktop edition only.' });
  }

  const backup = require('../db/backup');
  const stamp = new Date().toISOString().slice(0, 10);
  const tmp = path.join(os.tmpdir(), `dairy-manual-backup-${Date.now()}.db`);

  try {
    backup.createBackup(tmp);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(tmp + '.tmp', { force: true });
    return res.status(500).json({ error: err.message });
  }

  res.download(tmp, `dairy-backup-${stamp}.db`, () => {
    fs.rmSync(tmp, { force: true });
  });
});

module.exports = router;

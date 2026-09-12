const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const db = require('../db/connection');
const service = require('../services/settingsService');

const router = express.Router();

router.get('/', (req, res) => res.json(service.get()));
router.put('/', (req, res) => res.json(service.update(req.body)));

router.get('/backup', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const tmp = path.join(os.tmpdir(), `dairy-backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  res.download(tmp, `dairy-backup-${stamp}.db`, () => {
    fs.rmSync(tmp, { force: true });
  });
});

module.exports = router;

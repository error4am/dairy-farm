const express = require('express');
const service = require('../services/alertService');
const { parseId } = require('../utils/params');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    await service.maybeRunAlertEngine();
    res.json(await service.list(req.query));
  })
);

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    await service.maybeRunAlertEngine();
    res.json({ count: await service.unreadCount() });
  })
);

router.post('/run', asyncHandler(async (req, res) => res.json(await service.runAlertEngine())));

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => res.json(await service.markRead(parseId(req))))
);

router.post(
  '/:id/resolve',
  asyncHandler(async (req, res) => res.json(await service.resolve(parseId(req))))
);

module.exports = router;

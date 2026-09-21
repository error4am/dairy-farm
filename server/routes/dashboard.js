const express = require('express');
const service = require('../services/dashboardService');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => res.json(await service.get())));

module.exports = router;

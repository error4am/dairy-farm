const express = require('express');
const service = require('../services/dashboardService');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/milk-production', asyncHandler(async (req, res) => res.json(await service.milkProduction(req.query.range))));

router.get('/', asyncHandler(async (req, res) => res.json(await service.get())));

module.exports = router;

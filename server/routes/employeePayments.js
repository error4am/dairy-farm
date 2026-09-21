const express = require('express');
const service = require('../services/paymentService');
const { parseId } = require('../utils/params');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => res.json(await service.list(req.query))));
router.post('/', asyncHandler(async (req, res) => res.status(201).json(await service.create(req.body))));
router.put('/:id', asyncHandler(async (req, res) => res.json(await service.update(parseId(req), req.body))));
router.delete('/:id', asyncHandler(async (req, res) => res.json(await service.remove(parseId(req)))));

module.exports = router;

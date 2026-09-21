const express = require('express');
const service = require('../services/inventoryService');
const { parseId } = require('../utils/params');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => res.json(await service.list(req.query))));
router.get('/summary', asyncHandler(async (req, res) => res.json(await service.summary())));
router.get('/:id/profile', asyncHandler(async (req, res) => res.json(await service.profile(parseId(req)))));
router.get('/:id', asyncHandler(async (req, res) => res.json(await service.get(parseId(req)))));
router.post('/', asyncHandler(async (req, res) => res.status(201).json(await service.create(req.body))));
router.put('/:id', asyncHandler(async (req, res) => res.json(await service.update(parseId(req), req.body))));
router.delete('/:id', asyncHandler(async (req, res) => res.json(await service.remove(parseId(req)))));

module.exports = router;

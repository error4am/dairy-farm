const express = require('express');
const service = require('../services/inventoryMovementService');
const { parseId } = require('../utils/params');

const router = express.Router();

router.get('/', (req, res) => res.json(service.list(req.query)));
router.post('/', (req, res) => res.status(201).json(service.create(req.body)));
router.put('/:id', (req, res) => res.json(service.update(parseId(req), req.body)));
router.delete('/:id', (req, res) => res.json(service.remove(parseId(req))));

module.exports = router;

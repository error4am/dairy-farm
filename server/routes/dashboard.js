const express = require('express');
const service = require('../services/dashboardService');

const router = express.Router();

router.get('/', (req, res) => res.json(service.get()));

module.exports = router;

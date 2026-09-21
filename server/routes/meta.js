const express = require('express');
const settingsService = require('../services/settingsService');
const enums = require('../constants/enums');
const db = require('../db');
const { INCOME_CATEGORIES, EXPENSE_CATEGORIES } = require('../constants/categories');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      enums,
      categories: {
        income: INCOME_CATEGORIES,
        expense: EXPENSE_CATEGORIES
      },
      capabilities: {
        backup: !db.isPostgres,
        postgres: db.isPostgres
      },
      farm: await settingsService.get()
    });
  })
);

module.exports = router;

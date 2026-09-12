const express = require('express');
const settingsService = require('../services/settingsService');
const enums = require('../constants/enums');
const { INCOME_CATEGORIES, EXPENSE_CATEGORIES } = require('../constants/categories');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    enums,
    categories: {
      income: INCOME_CATEGORIES,
      expense: EXPENSE_CATEGORIES
    },
    farm: settingsService.get()
  });
});

module.exports = router;

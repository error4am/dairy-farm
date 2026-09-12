const INCOME_CATEGORIES = [
  { value: 'milk_sale', label: 'Milk Sale' },
  { value: 'animal_sale', label: 'Animal Sale' },
  { value: 'other_income', label: 'Other Income' }
];

const EXPENSE_CATEGORIES = [
  { value: 'feed', label: 'Feed' },
  { value: 'medicine', label: 'Medicine' },
  { value: 'labor', label: 'Labor' },
  { value: 'electricity', label: 'Electricity' },
  { value: 'transportation', label: 'Transportation' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'other_expense', label: 'Other Expense' }
];

function isValidCategory(type, value) {
  const list = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return list.some((c) => c.value === value);
}

module.exports = {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  isValidCategory
};

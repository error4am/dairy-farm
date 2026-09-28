const ANIMAL_TYPES = ['cow', 'buffalo', 'other'];
const GENDERS = ['female', 'male'];
const ANIMAL_STATUSES = ['active', 'sold', 'deceased'];
const SESSIONS = ['morning', 'evening'];
const TX_TYPES = ['income', 'expense'];
const WEEK_STARTS = ['monday', 'sunday'];
const HEALTH_TYPES = ['vaccination', 'treatment', 'illness', 'checkup', 'deworming', 'other'];
const SERVICE_METHODS = ['natural', 'artificial_insemination', 'other'];
const PREGNANCY_RESULTS = ['pending', 'pregnant', 'not_pregnant'];
const CALVING_OUTCOMES = ['pending', 'successful', 'complication', 'aborted', 'other'];
const EMPLOYEE_STATUSES = ['active', 'inactive'];
const PAY_TYPES = ['monthly', 'daily'];
const PAYMENT_TYPES = ['salary', 'advance', 'bonus', 'other'];
const INVENTORY_CATEGORIES = ['concentrate', 'silage', 'fodder', 'mineral', 'supply', 'other'];
const INVENTORY_MOVEMENT_TYPES = ['opening', 'purchase', 'consumption', 'waste', 'adjustment'];
const ADJUSTMENT_DIRECTIONS = ['increase', 'decrease'];
const ALERT_TYPES = [
  'pregnancy_check',
  'calving',
  'treatment_followup',
  'vaccination',
  'milk_withdrawal',
  'low_stock',
  'out_of_stock'
];
const ALERT_SEVERITIES = ['info', 'warning', 'critical'];
const ALERT_STATUSES = ['unread', 'read', 'resolved'];
const ALERT_SOURCE_TYPES = ['breeding', 'health', 'inventory_item'];

module.exports = {
  ANIMAL_TYPES,
  GENDERS,
  ANIMAL_STATUSES,
  SESSIONS,
  TX_TYPES,
  WEEK_STARTS,
  HEALTH_TYPES,
  SERVICE_METHODS,
  PREGNANCY_RESULTS,
  CALVING_OUTCOMES,
  EMPLOYEE_STATUSES,
  PAY_TYPES,
  PAYMENT_TYPES,
  INVENTORY_CATEGORIES,
  INVENTORY_MOVEMENT_TYPES,
  ADJUSTMENT_DIRECTIONS,
  ALERT_TYPES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_SOURCE_TYPES
};

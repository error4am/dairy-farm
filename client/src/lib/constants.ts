import type {
  AnimalStatus,
  AnimalType,
  CalvingOutcome,
  EmployeeStatus,
  Gender,
  HealthType,
  InventoryCategory,
  InventoryMovementType,
  Meta,
  PayType,
  PaymentType,
  PregnancyResult,
  ServiceMethod,
  Session,
  TxType
} from './types';

export const ANIMAL_TYPE_LABELS: Record<AnimalType, string> = {
  cow: 'Cow',
  buffalo: 'Buffalo',
  other: 'Other'
};

export const GENDER_LABELS: Record<Gender, string> = {
  female: 'Female',
  male: 'Male'
};

export const ANIMAL_STATUS_LABELS: Record<AnimalStatus, string> = {
  active: 'Active',
  sold: 'Sold',
  deceased: 'Deceased'
};

export const SESSION_LABELS: Record<Session, string> = {
  morning: 'Morning',
  evening: 'Evening'
};

export const TX_TYPE_LABELS: Record<TxType, string> = {
  income: 'Income',
  expense: 'Expense'
};

export const STATUS_TONES: Record<AnimalStatus, 'green' | 'gray' | 'red'> = {
  active: 'green',
  sold: 'gray',
  deceased: 'red'
};

export const HEALTH_TYPE_LABELS: Record<HealthType, string> = {
  vaccination: 'Vaccination',
  treatment: 'Treatment',
  illness: 'Illness',
  checkup: 'Checkup',
  deworming: 'Deworming',
  other: 'Other'
};

export const HEALTH_TYPE_TONES: Record<HealthType, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
  vaccination: 'blue',
  treatment: 'amber',
  illness: 'red',
  checkup: 'green',
  deworming: 'blue',
  other: 'gray'
};

export const SERVICE_METHOD_LABELS: Record<ServiceMethod, string> = {
  natural: 'Natural',
  artificial_insemination: 'Artificial Insemination',
  other: 'Other'
};

export const PREGNANCY_RESULT_LABELS: Record<PregnancyResult, string> = {
  pending: 'Pending',
  pregnant: 'Pregnant',
  not_pregnant: 'Not Pregnant'
};

export const PREGNANCY_RESULT_TONES: Record<PregnancyResult, 'green' | 'amber' | 'gray'> = {
  pending: 'amber',
  pregnant: 'green',
  not_pregnant: 'gray'
};

export const CALVING_OUTCOME_LABELS: Record<CalvingOutcome, string> = {
  pending: 'Pending',
  successful: 'Successful',
  complication: 'Complication',
  aborted: 'Aborted',
  other: 'Other'
};

export const CALVING_OUTCOME_TONES: Record<CalvingOutcome, 'green' | 'amber' | 'red' | 'gray'> = {
  pending: 'gray',
  successful: 'green',
  complication: 'amber',
  aborted: 'red',
  other: 'gray'
};

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: 'Active',
  inactive: 'Inactive'
};

export const EMPLOYEE_STATUS_TONES: Record<EmployeeStatus, 'green' | 'gray'> = {
  active: 'green',
  inactive: 'gray'
};

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  monthly: 'Monthly',
  daily: 'Daily'
};

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  salary: 'Salary',
  advance: 'Advance',
  bonus: 'Bonus',
  other: 'Other'
};

export const PAYMENT_TYPE_TONES: Record<PaymentType, 'green' | 'amber' | 'blue' | 'gray'> = {
  salary: 'green',
  advance: 'amber',
  bonus: 'blue',
  other: 'gray'
};

export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategory, string> = {
  concentrate: 'Concentrate',
  silage: 'Silage',
  fodder: 'Fodder',
  mineral: 'Mineral Mix',
  supply: 'Supply',
  other: 'Other'
};

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  opening: 'Opening Stock',
  purchase: 'Purchase',
  consumption: 'Consumption',
  waste: 'Waste',
  adjustment: 'Adjustment'
};

export const MOVEMENT_TYPE_TONES: Record<InventoryMovementType, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
  opening: 'blue',
  purchase: 'green',
  consumption: 'amber',
  waste: 'red',
  adjustment: 'gray'
};

export const FALLBACK_META: Meta = {
  enums: {
    ANIMAL_TYPES: ['cow', 'buffalo', 'other'],
    GENDERS: ['female', 'male'],
    ANIMAL_STATUSES: ['active', 'sold', 'deceased'],
    SESSIONS: ['morning', 'evening'],
    TX_TYPES: ['income', 'expense'],
    WEEK_STARTS: ['monday', 'sunday'],
    HEALTH_TYPES: ['vaccination', 'treatment', 'illness', 'checkup', 'deworming', 'other'],
    SERVICE_METHODS: ['natural', 'artificial_insemination', 'other'],
    PREGNANCY_RESULTS: ['pending', 'pregnant', 'not_pregnant'],
    CALVING_OUTCOMES: ['pending', 'successful', 'complication', 'aborted', 'other'],
    EMPLOYEE_STATUSES: ['active', 'inactive'],
    PAY_TYPES: ['monthly', 'daily'],
    PAYMENT_TYPES: ['salary', 'advance', 'bonus', 'other'],
    INVENTORY_CATEGORIES: ['concentrate', 'silage', 'fodder', 'mineral', 'supply', 'other'],
    INVENTORY_MOVEMENT_TYPES: ['opening', 'purchase', 'consumption', 'waste', 'adjustment'],
    ADJUSTMENT_DIRECTIONS: ['increase', 'decrease']
  },
  categories: {
    income: [
      { value: 'milk_sale', label: 'Milk Sale' },
      { value: 'animal_sale', label: 'Animal Sale' },
      { value: 'other_income', label: 'Other Income' }
    ],
    expense: [
      { value: 'feed', label: 'Feed' },
      { value: 'medicine', label: 'Medicine' },
      { value: 'labor', label: 'Labor' },
      { value: 'electricity', label: 'Electricity' },
      { value: 'transportation', label: 'Transportation' },
      { value: 'equipment', label: 'Equipment' },
      { value: 'other_expense', label: 'Other Expense' }
    ]
  },
  farm: {
    id: 1,
    name: 'My Dairy Farm',
    currency: 'PKR',
    milk_unit: 'L',
    week_start: 'monday',
    gestation_days: 283,
    created_at: '',
    updated_at: ''
  }
};

export const MILK_UNITS = [
  { value: 'L', label: 'Liters (L)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'gal', label: 'Gallons (gal)' }
];

export const CURRENCIES = ['PKR', 'INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR'];

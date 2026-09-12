import type { AnimalStatus, AnimalType, Gender, HealthType, Meta, Session, TxType } from './types';

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

export const FALLBACK_META: Meta = {
  enums: {
    ANIMAL_TYPES: ['cow', 'buffalo', 'other'],
    GENDERS: ['female', 'male'],
    ANIMAL_STATUSES: ['active', 'sold', 'deceased'],
    SESSIONS: ['morning', 'evening'],
    TX_TYPES: ['income', 'expense'],
    WEEK_STARTS: ['monday', 'sunday'],
    HEALTH_TYPES: ['vaccination', 'treatment', 'illness', 'checkup', 'deworming', 'other']
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

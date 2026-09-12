export type AnimalType = 'cow' | 'buffalo' | 'other';
export type Gender = 'female' | 'male';
export type AnimalStatus = 'active' | 'sold' | 'deceased';
export type Session = 'morning' | 'evening';
export type TxType = 'income' | 'expense';
export type WeekStart = 'monday' | 'sunday';
export type HealthType = 'vaccination' | 'treatment' | 'illness' | 'checkup' | 'deworming' | 'other';

export interface Farm {
  id: number;
  name: string;
  currency: string;
  milk_unit: string;
  week_start: WeekStart;
  created_at: string;
  updated_at: string;
}

export interface Animal {
  id: number;
  farm_id: number;
  tag_number: string;
  name: string | null;
  type: AnimalType;
  breed: string | null;
  gender: Gender;
  date_of_birth: string | null;
  purchase_date: string | null;
  status: AnimalStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  total_milk?: number;
  last_milk_date?: string | null;
  withdrawal_until?: string | null;
}

export interface MilkRecord {
  id: number;
  farm_id: number;
  animal_id: number;
  date: string;
  session: Session;
  quantity: number;
  unit: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  animal_tag?: string;
  animal_name?: string | null;
}

export interface Transaction {
  id: number;
  farm_id: number;
  animal_id: number | null;
  date: string;
  type: TxType;
  category: string;
  amount: number;
  description: string | null;
  created_at: string;
  updated_at: string;
  animal_tag?: string | null;
  animal_name?: string | null;
}

export interface HealthRecord {
  id: number;
  farm_id: number;
  animal_id: number;
  date: string;
  type: HealthType;
  condition: string | null;
  medicine: string | null;
  dosage: string | null;
  vet_name: string | null;
  withdrawal_until: string | null;
  next_due_date: string | null;
  notes: string | null;
  transaction_id: number | null;
  created_at: string;
  updated_at: string;
  animal_tag?: string;
  animal_name?: string | null;
  cost?: number | null;
}

export interface HealthSummary {
  today: string;
  events_this_month: number;
  by_type: { type: HealthType; count: number }[];
  withdrawals: { animal_id: number; tag_number: string; name: string | null; withdrawal_until: string }[];
  withdrawal_count: number;
  due_soon: {
    id: number;
    animal_id: number;
    tag_number: string;
    name: string | null;
    type: HealthType;
    condition: string | null;
    next_due_date: string;
  }[];
  due_soon_count: number;
}

export interface Category {
  value: string;
  label: string;
}

export interface Meta {
  enums: {
    ANIMAL_TYPES: string[];
    GENDERS: string[];
    ANIMAL_STATUSES: string[];
    SESSIONS: string[];
    TX_TYPES: string[];
    WEEK_STARTS: string[];
    HEALTH_TYPES: string[];
  };
  categories: {
    income: Category[];
    expense: Category[];
  };
  farm: Farm;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Dashboard {
  farm: Farm;
  today: string;
  metrics: {
    active_animals: number;
    milk_today: number;
    milk_today_morning: number;
    milk_today_evening: number;
    milk_week: number;
    revenue_all_time: number;
    expenses_all_time: number;
    net_all_time: number;
    unit: string;
    health: {
      withdrawal_count: number;
      due_soon_count: number;
      events_this_month: number;
    };
  };
  recent_activity: {
    kind: 'milk' | 'transaction' | 'animal';
    id: number;
    at: string;
    title: string;
    subtitle: string;
    tone: 'green' | 'red' | 'gray';
  }[];
  milk_last_7_days: { date: string; total: number }[];
}

export interface MilkSummary {
  unit: string;
  range: {
    from: string | null;
    to: string | null;
    total: number;
    morning: number;
    evening: number;
    records: number;
  };
  today: { total: number; morning: number; evening: number };
  week: number;
  month: number;
  by_day: { date: string; total: number; morning: number; evening: number }[];
  by_animal: {
    animal_id: number;
    tag_number: string;
    name: string | null;
    total: number;
    morning: number;
    evening: number;
    records: number;
  }[];
}

export interface FinanceSummary {
  range: {
    from: string | null;
    to: string | null;
    income: number;
    expenses: number;
    net: number;
    count: number;
  };
  all_time: { from: null; to: null; income: number; expenses: number; net: number; count: number };
  by_category: { type: TxType; category: string; amount: number; count: number }[];
}

export interface AnimalProfile {
  animal: Animal;
  milk: {
    total: number;
    morning: number;
    evening: number;
    records: number;
    last_milk_date: string | null;
    this_month: number;
  };
  recent_milk: MilkRecord[];
  finance: { income: number; expenses: number; net: number };
  recent_transactions: Transaction[];
  monthly_milk: { month: string; total: number }[];
  recent_health: HealthRecord[];
}

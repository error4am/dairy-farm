export type AnimalType = 'cow' | 'buffalo' | 'other';
export type Gender = 'female' | 'male';
export type AnimalStatus = 'active' | 'sold' | 'deceased';
export type Session = 'morning' | 'evening';
export type TxType = 'income' | 'expense';
export type WeekStart = 'monday' | 'sunday';
export type HealthType = 'vaccination' | 'treatment' | 'illness' | 'checkup' | 'deworming' | 'other';
export type ServiceMethod = 'natural' | 'artificial_insemination' | 'other';
export type PregnancyResult = 'pending' | 'pregnant' | 'not_pregnant';
export type CalvingOutcome = 'pending' | 'successful' | 'complication' | 'aborted' | 'other';
export type EmployeeStatus = 'active' | 'inactive';
export type PayType = 'monthly' | 'daily';
export type PaymentType = 'salary' | 'advance' | 'bonus' | 'other';
export type InventoryCategory = 'concentrate' | 'silage' | 'fodder' | 'mineral' | 'supply' | 'other';
export type InventoryMovementType = 'opening' | 'purchase' | 'consumption' | 'waste' | 'adjustment';
export type AdjustmentDirection = 'increase' | 'decrease';

export interface Farm {
  id: number;
  name: string;
  currency: string;
  milk_unit: string;
  week_start: WeekStart;
  gestation_days: number;
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

export interface MilkPrice {
  id: number;
  farm_id: number;
  price_per_litre: number;
  effective_date: string;
  created_at: string;
}

export interface MilkSale {
  id: number;
  farm_id: number;
  date: string;
  litres: number;
  price_per_litre: number;
  revenue: number;
  notes: string | null;
  transaction_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface MilkSaleSummary {
  unit: string;
  currency: string;
  current_price: number | null;
  range: {
    from: string | null;
    to: string | null;
    produced: number;
    sold: number;
    remaining: number;
    revenue: number;
    sales_count: number;
  };
  today: { sold: number; revenue: number; sales_count: number };
  week: { sold: number; revenue: number; sales_count: number };
  month: { sold: number; revenue: number; sales_count: number };
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
  employee_id?: number | null;
  employee_name?: string | null;
  employee_code?: string | null;
  payment_type?: PaymentType | null;
  health_record_id?: number | null;
  inventory_movement_id?: number | null;
  inventory_item_id?: number | null;
  milk_sale_id?: number | null;
}

export interface Employee {
  id: number;
  farm_id: number;
  employee_id: string;
  name: string;
  phone: string | null;
  role: string | null;
  joining_date: string | null;
  status: EmployeeStatus;
  pay_type: PayType;
  salary: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  paid_total?: number;
  last_payment_date?: string | null;
  payments_count?: number;
}

export interface EmployeePayment {
  id: number;
  farm_id: number;
  employee_id: number;
  transaction_id: number | null;
  date: string;
  type: PaymentType;
  amount: number;
  description: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  employee_name?: string;
  employee_code?: string;
  employee_status?: EmployeeStatus;
}

export interface EmployeeSummary {
  active_count: number;
  inactive_count: number;
  roles: string[];
}

export interface EmployeeProfile {
  employee: Employee;
  finance: {
    total_paid: number;
    this_month_paid: number;
    total_advances: number;
    outstanding_advances: number;
    payments_count: number;
    last_payment_date: string | null;
  };
  recent_payments: EmployeePayment[];
  monthly_paid: { month: string; total: number }[];
}

export interface InventoryItem {
  id: number;
  farm_id: number;
  name: string;
  category: InventoryCategory;
  unit: string;
  minimum_stock: number | null;
  active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  current_stock: number;
  movements_count: number;
  last_movement_date: string | null;
}

export interface InventoryMovement {
  id: number;
  farm_id: number;
  item_id: number;
  date: string;
  type: InventoryMovementType;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  total_cost: number | null;
  supplier: string | null;
  notes: string | null;
  transaction_id: number | null;
  created_at: string;
  updated_at: string;
  item_name?: string;
  item_unit?: string;
  item_category?: InventoryCategory;
  item_active?: number;
}

export interface InventorySummary {
  active_count: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

export interface InventoryItemProfile {
  item: InventoryItem;
  stock: {
    current: number;
    opening: number;
    purchased: number;
    consumed: number;
    wasted: number;
    adjusted: number;
    movements_count: number;
    last_movement_date: string | null;
  };
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

export interface BreedingRecord {
  id: number;
  farm_id: number;
  animal_id: number;
  heat_date: string | null;
  service_date: string | null;
  service_method: ServiceMethod | null;
  sire_info: string | null;
  pregnancy_check_date: string | null;
  pregnancy_result: PregnancyResult;
  expected_calving_date: string | null;
  expected_calving_estimated: number;
  actual_calving_date: string | null;
  calving_outcome: CalvingOutcome;
  offspring_count: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  animal_tag?: string;
  animal_name?: string | null;
}

export interface BreedingSummary {
  today: string;
  currently_pregnant_count: number;
  calving_soon_count: number;
  pending_checks_count: number;
  events_this_month: number;
  currently_pregnant: BreedingRecord[];
  calving_soon: BreedingRecord[];
  pending_checks: BreedingRecord[];
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
    SERVICE_METHODS: string[];
    PREGNANCY_RESULTS: string[];
    CALVING_OUTCOMES: string[];
    EMPLOYEE_STATUSES: string[];
    PAY_TYPES: string[];
    PAYMENT_TYPES: string[];
    INVENTORY_CATEGORIES: string[];
    INVENTORY_MOVEMENT_TYPES: string[];
    ADJUSTMENT_DIRECTIONS: string[];
  };
  categories: {
    income: Category[];
    expense: Category[];
  };
  capabilities: {
    backup: boolean;
    postgres: boolean;
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
    breeding: {
      currently_pregnant: number;
      calving_soon: number;
      pending_checks: number;
    };
    employees: {
      active_count: number;
      labor_cost_this_month: number;
    };
    inventory: {
      active_items: number;
      low_stock: number;
      out_of_stock: number;
    };
    milk_sales: {
      sold_today: number;
      revenue_today: number;
      sold_month: number;
      revenue_month: number;
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
  breeding: {
    current: BreedingRecord | null;
    recent: BreedingRecord[];
  };
}

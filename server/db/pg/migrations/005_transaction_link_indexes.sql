CREATE INDEX IF NOT EXISTS idx_health_transaction ON health_records(transaction_id);
CREATE INDEX IF NOT EXISTS idx_emp_pay_transaction ON employee_payments(transaction_id);

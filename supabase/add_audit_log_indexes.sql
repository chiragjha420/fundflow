-- Migration: Add Performance Indexes for Audit Log and Cash Transactions
-- Solves sequential table scans and speeds up balances, hisaab, and advance queries

-- 1. Index on audit_log for table_name and action queries
CREATE INDEX IF NOT EXISTS idx_audit_log_table_action ON audit_log (table_name, action);

-- 2. Index on audit_log for descending date scans
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log (changed_at DESC);

-- 3. Composite Index on cash_transactions for supervisor feeds
CREATE INDEX IF NOT EXISTS idx_cash_tx_from_sup_created ON cash_transactions (from_supervisor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_tx_to_sup_created ON cash_transactions (to_supervisor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_tx_to_worker_created ON cash_transactions (to_worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_tx_type_status ON cash_transactions (type, status);

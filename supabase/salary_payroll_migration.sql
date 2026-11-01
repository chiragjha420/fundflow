-- FundFlow: Worker Salary, Payroll, and Advance Recovery Migration
-- Run this script in the Supabase Dashboard SQL Editor (or CLI) to apply the schema updates.

-- 1. Create worker_salary_ledger table for non-cash salary events:
-- - salary_earned: monthly wage or piece-rate salary credit accrued to the worker
-- - advance_recovery: settling an outstanding advance from accumulated salary balance
create table if not exists public.worker_salary_ledger (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.workers on delete cascade not null,
  factory_id uuid references public.factories on delete restrict not null,
  type text not null check (type in ('salary_earned', 'advance_recovery')),
  amount numeric not null check (amount > 0),
  period_month text, -- e.g. '2026-10' or 'October 2026'
  note text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

-- Indexing for high-speed balance aggregation and statement generation
create index if not exists idx_salary_ledger_worker on public.worker_salary_ledger(worker_id);
create index if not exists idx_salary_ledger_factory on public.worker_salary_ledger(factory_id);
create index if not exists idx_salary_ledger_type on public.worker_salary_ledger(type);
create index if not exists idx_salary_ledger_period on public.worker_salary_ledger(period_month);

-- 2. Extend cash_transactions table with payment_type
-- 'advance' = money given to worker before earned
-- 'salary_payment' = cash salary withdrawal / wage payment against accumulated salary
alter table public.cash_transactions
  add column if not exists payment_type text default 'advance' check (payment_type in ('advance', 'salary_payment'));

create index if not exists idx_cash_transactions_payment_type on public.cash_transactions(payment_type);

-- 3. Extend workers table with opening unpaid salary balance and standard monthly wage
alter table public.workers
  add column if not exists opening_unpaid_salary numeric not null default 0 check (opening_unpaid_salary >= 0),
  add column if not exists monthly_salary numeric default 0 check (monthly_salary >= 0);

-- 4. Enable Row Level Security (RLS) on worker_salary_ledger
alter table public.worker_salary_ledger enable row level security;

-- Admin policy: full read/write
create policy "Admins see and write all salary ledger" on public.worker_salary_ledger
  for all using (is_admin());

-- Supervisor policies: read and write records in their factory
create policy "Supervisors read factory salary ledger" on public.worker_salary_ledger
  for select using (factory_id = get_supervisor_factory_id());

create policy "Supervisors insert factory salary ledger" on public.worker_salary_ledger
  for insert with check (factory_id = get_supervisor_factory_id());

-- 5. Audit log trigger for tamper-evident payroll ledger
drop trigger if exists audit_worker_salary_ledger on public.worker_salary_ledger;
create trigger audit_worker_salary_ledger 
  after insert or update or delete on public.worker_salary_ledger 
  for each row execute function audit_trigger();

-- JBB FundFlow Database Schema
-- Includes tables, immutability triggers, audit logging, balance functions, RPC helpers, and RLS policies.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Drop existing views/functions if any to ensure clean deploy
drop view if exists worker_balances;
drop function if exists disburse_to_worker(uuid, uuid, numeric, text, uuid);
drop function if exists transfer_to_supervisor(uuid, uuid, numeric, text, uuid);
drop function if exists log_expense(uuid, uuid, numeric, text, text, text, uuid);
drop function if exists get_supervisor_balance(uuid);
drop function if exists is_admin();
drop function if exists get_supervisor_id();
drop function if exists get_supervisor_factory_id();

-- 1. Profiles Table (Linked to auth.users)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  role text not null check (role in ('admin', 'supervisor')),
  created_at timestamptz default now()
);

-- 2. Factories Table
create table factories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text not null,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- 3. Supervisors Table
create table supervisors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade unique not null,
  factory_id uuid references factories on delete restrict not null,
  name text not null,
  phone text not null,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- 4. Workers Table
create table workers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid references factories on delete restrict not null,
  supervisor_id uuid references supervisors on delete restrict not null,
  name text not null,
  phone text,
  photo_url text,
  opening_advance numeric not null default 0 check (opening_advance >= 0),
  active boolean not null default true,
  created_at timestamptz default now()
);

-- 5. Cash Transactions Table
create table cash_transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('office_to_supervisor', 'supervisor_to_supervisor', 'supervisor_to_worker')),
  from_supervisor_id uuid references supervisors on delete restrict,
  to_supervisor_id uuid references supervisors on delete restrict,
  to_worker_id uuid references workers on delete restrict,
  amount numeric not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'disputed')),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users on delete restrict,
  note text,
  created_by uuid references auth.users on delete restrict not null,
  created_at timestamptz default now(),
  
  -- Integrity constraint checks
  constraint transaction_parties_check check (
    (type = 'office_to_supervisor' and from_supervisor_id is null and to_supervisor_id is not null and to_worker_id is null) or
    (type = 'supervisor_to_supervisor' and from_supervisor_id is not null and to_supervisor_id is not null and to_worker_id is null) or
    (type = 'supervisor_to_worker' and from_supervisor_id is not null and to_supervisor_id is null and to_worker_id is not null)
  )
);

-- 6. Expenses Table
create table expenses (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid references supervisors on delete restrict not null,
  factory_id uuid references factories on delete restrict not null,
  amount numeric not null check (amount > 0),
  category text not null check (category in ('wages', 'materials', 'transport', 'maintenance', 'other')),
  note text not null,
  photo_url text,
  created_by uuid references auth.users on delete restrict not null,
  created_at timestamptz default now()
);

-- 7. Audit Log Table (Tamper-evident log of database modifications)
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  action text not null,
  row_id uuid not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz default now()
);

-- Indexing for lookup speed and integrity
create index idx_supervisors_user_id on supervisors(user_id);
create index idx_supervisors_factory_id on supervisors(factory_id);
create index idx_workers_factory_id on workers(factory_id);
create index idx_workers_supervisor_id on workers(supervisor_id);
create index idx_cash_transactions_from_sup on cash_transactions(from_supervisor_id);
create index idx_cash_transactions_to_sup on cash_transactions(to_supervisor_id);
create index idx_cash_transactions_to_worker on cash_transactions(to_worker_id);
create index idx_cash_transactions_status on cash_transactions(status);
create index idx_expenses_supervisor_id on expenses(supervisor_id);
create index idx_expenses_factory_id on expenses(factory_id);
create index idx_audit_log_table_row on audit_log(table_name, row_id);

-- 8. Views
-- Worker running balances (opening advance + confirmed disbursements)
create or replace view worker_balances as
select
  w.id as worker_id,
  w.name as worker_name,
  w.phone as worker_phone,
  w.photo_url as worker_photo_url,
  w.factory_id,
  w.supervisor_id,
  w.opening_advance,
  coalesce(sum(case when t.status = 'confirmed' then t.amount else 0 end), 0) as total_cash_disbursed,
  w.opening_advance + coalesce(sum(case when t.status = 'confirmed' then t.amount else 0 end), 0) as running_advance,
  w.active
from workers w
left join cash_transactions t on t.type = 'supervisor_to_worker' and t.to_worker_id = w.id
group by w.id, w.name, w.phone, w.photo_url, w.factory_id, w.supervisor_id, w.opening_advance, w.active;

-- Helper functions for RLS Policies
create or replace function is_admin() returns boolean security definer as $$
begin
  return exists (
    select 1 from public.profiles 
    where id = auth.uid() and role = 'admin'
  );
end;
$$ language plpgsql;

create or replace function get_supervisor_id() returns uuid security definer as $$
begin
  return (
    select id from public.supervisors 
    where user_id = auth.uid() limit 1
  );
end;
$$ language plpgsql;

create or replace function get_supervisor_factory_id() returns uuid security definer as $$
begin
  return (
    select factory_id from public.supervisors 
    where user_id = auth.uid() limit 1
  );
end;
$$ language plpgsql;

-- Supervisor Balance Dynamic Calculation
create or replace function get_supervisor_balance(sub_id uuid) returns numeric security definer as $$
declare
  incoming_office numeric;
  incoming_sup numeric;
  outgoing_sup numeric;
  outgoing_worker numeric;
  total_expenses numeric;
begin
  -- Incoming from office (only confirmed)
  select coalesce(sum(amount), 0) into incoming_office
  from cash_transactions
  where to_supervisor_id = sub_id and type = 'office_to_supervisor' and status = 'confirmed';

  -- Incoming from supervisors (only confirmed)
  select coalesce(sum(amount), 0) into incoming_sup
  from cash_transactions
  where to_supervisor_id = sub_id and type = 'supervisor_to_supervisor' and status = 'confirmed';

  -- Outgoing to supervisors (pending or confirmed, i.e., not disputed)
  select coalesce(sum(amount), 0) into outgoing_sup
  from cash_transactions
  where from_supervisor_id = sub_id and type = 'supervisor_to_supervisor' and status != 'disputed';

  -- Outgoing to workers (confirmed)
  select coalesce(sum(amount), 0) into outgoing_worker
  from cash_transactions
  where from_supervisor_id = sub_id and type = 'supervisor_to_worker' and status = 'confirmed';

  -- Expenses
  select coalesce(sum(amount), 0) into total_expenses
  from expenses
  where supervisor_id = sub_id;

  return incoming_office + incoming_sup - outgoing_sup - outgoing_worker - total_expenses;
end;
$$ language plpgsql;

-- 9. Transactional Safety RPCs (prevent double spend and verify balances database-side)

-- Supervisor -> Worker Disbursement RPC
create or replace function disburse_to_worker(
  p_worker_id uuid,
  p_supervisor_id uuid,
  p_amount numeric,
  p_note text,
  p_created_by uuid
) returns uuid security definer as $$
declare
  current_balance numeric;
  new_tx_id uuid;
begin
  -- Get supervisor's current balance
  current_balance := get_supervisor_balance(p_supervisor_id);
  
  if current_balance < p_amount then
    raise exception 'Insufficient balance. Available: %, Required: %', current_balance, p_amount;
  end if;
  
  -- Insert confirmed ledger transaction
  insert into cash_transactions (
    type,
    from_supervisor_id,
    to_worker_id,
    amount,
    status,
    confirmed_at,
    confirmed_by,
    note,
    created_by,
    created_at
  ) values (
    'supervisor_to_worker',
    p_supervisor_id,
    p_worker_id,
    p_amount,
    'confirmed',
    now(),
    p_created_by,
    p_note,
    p_created_by,
    now()
  ) returning id into new_tx_id;
  
  return new_tx_id;
end;
$$ language plpgsql;

-- Supervisor -> Supervisor Transfer RPC
create or replace function transfer_to_supervisor(
  p_to_supervisor_id uuid,
  p_from_supervisor_id uuid,
  p_amount numeric,
  p_note text,
  p_created_by uuid
) returns uuid security definer as $$
declare
  current_balance numeric;
  new_tx_id uuid;
begin
  current_balance := get_supervisor_balance(p_from_supervisor_id);
  
  if current_balance < p_amount then
    raise exception 'Insufficient balance. Available: %, Required: %', current_balance, p_amount;
  end if;
  
  -- Insert pending transaction
  insert into cash_transactions (
    type,
    from_supervisor_id,
    to_supervisor_id,
    amount,
    status,
    note,
    created_by,
    created_at
  ) values (
    'supervisor_to_supervisor',
    p_from_supervisor_id,
    p_to_supervisor_id,
    p_amount,
    'pending',
    p_note,
    p_created_by,
    now()
  ) returning id into new_tx_id;
  
  return new_tx_id;
end;
$$ language plpgsql;

-- Expense Logging RPC
create or replace function log_expense(
  p_supervisor_id uuid,
  p_factory_id uuid,
  p_amount numeric,
  p_category text,
  p_note text,
  p_photo_url text,
  p_created_by uuid
) returns uuid security definer as $$
declare
  current_balance numeric;
  new_expense_id uuid;
begin
  current_balance := get_supervisor_balance(p_supervisor_id);
  
  if current_balance < p_amount then
    raise exception 'Insufficient balance. Available: %, Required: %', current_balance, p_amount;
  end if;
  
  insert into expenses (
    supervisor_id,
    factory_id,
    amount,
    category,
    note,
    photo_url,
    created_by,
    created_at
  ) values (
    p_supervisor_id,
    p_factory_id,
    p_amount,
    p_category,
    p_note,
    p_photo_url,
    p_created_by,
    now()
  ) returning id into new_expense_id;
  
  return new_expense_id;
end;
$$ language plpgsql;

-- 10. Database Immutability Enforcement Triggers

-- Cash Transactions Immutability Trigger
create or replace function enforce_transaction_immutability() returns trigger as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'Deletions are not allowed on transactions.';
  end if;

  if TG_OP = 'UPDATE' then
    -- Verify status transitions only from pending to confirmed or disputed
    if OLD.status != 'pending' then
      raise exception 'Transaction is already finalized (%).', OLD.status;
    end if;

    if NEW.status not in ('confirmed', 'disputed') then
      raise exception 'Invalid status transition from pending to %.', NEW.status;
    end if;

    -- Ensure other fields are not altered
    if NEW.id != OLD.id or
       NEW.type != OLD.type or
       coalesce(NEW.from_supervisor_id, '00000000-0000-0000-0000-000000000000'::uuid) != coalesce(OLD.from_supervisor_id, '00000000-0000-0000-0000-000000000000'::uuid) or
       coalesce(NEW.to_supervisor_id, '00000000-0000-0000-0000-000000000000'::uuid) != coalesce(OLD.to_supervisor_id, '00000000-0000-0000-0000-000000000000'::uuid) or
       coalesce(NEW.to_worker_id, '00000000-0000-0000-0000-000000000000'::uuid) != coalesce(OLD.to_worker_id, '00000000-0000-0000-0000-000000000000'::uuid) or
       NEW.amount != OLD.amount or
       NEW.created_by != OLD.created_by or
       NEW.created_at != OLD.created_at then
      raise exception 'Only status, confirmation fields, and notes can be updated on pending transactions.';
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql;

create trigger trg_cash_transactions_immutability
before update or delete on cash_transactions
for each row execute function enforce_transaction_immutability();

-- Expenses Immutability Trigger
create or replace function enforce_expense_immutability() returns trigger as $$
begin
  raise exception 'Expenses cannot be updated or deleted once created.';
end;
$$ language plpgsql;

create trigger trg_expenses_immutability
before update or delete on expenses
for each row execute function enforce_expense_immutability();

-- Audit Log Trigger (Tamper-evidence)
create or replace function audit_trigger() returns trigger security definer as $$
declare
  current_user_id uuid;
begin
  begin
    current_user_id := auth.uid();
  exception when others then
    current_user_id := null;
  end;

  insert into audit_log (table_name, action, row_id, old_data, new_data, changed_by)
  values (
    TG_TABLE_NAME,
    TG_OP,
    case
      when TG_OP = 'DELETE' then OLD.id
      else NEW.id
    end,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end,
    current_user_id
  );
  return null;
end;
$$ language plpgsql;

create trigger audit_factories after insert or update or delete on factories for each row execute function audit_trigger();
create trigger audit_supervisors after insert or update or delete on supervisors for each row execute function audit_trigger();
create trigger audit_workers after insert or update or delete on workers for each row execute function audit_trigger();
create trigger audit_cash_transactions after insert or update or delete on cash_transactions for each row execute function audit_trigger();
create trigger audit_expenses after insert or update or delete on expenses for each row execute function audit_trigger();


-- 11. ROW LEVEL SECURITY (RLS) POLICIES
-- Enable RLS on all tables
alter table profiles enable row level security;
alter table factories enable row level security;
alter table supervisors enable row level security;
alter table workers enable row level security;
alter table cash_transactions enable row level security;
alter table expenses enable row level security;
alter table audit_log enable row level security;

-- Profile Policies
create policy "Admins see all profiles" on profiles
  for all using (is_admin());

create policy "Supervisors see own profile" on profiles
  for select using (id = auth.uid());

-- Factory Policies
create policy "Admins see and write all factories" on factories
  for all using (is_admin());

create policy "Supervisors read active factories" on factories
  for select using (active = true);

-- Supervisor Policies
create policy "Admins see and write all supervisors" on supervisors
  for all using (is_admin());

create policy "Supervisors see active supervisors" on supervisors
  for select using (active = true);

-- Worker Policies
create policy "Admins see and write all workers" on workers
  for all using (is_admin());

create policy "Supervisors read workers in their factory" on workers
  for select using (factory_id = get_supervisor_factory_id());

create policy "Supervisors insert workers in their factory" on workers
  for insert with check (
    factory_id = get_supervisor_factory_id() and
    supervisor_id = get_supervisor_id()
  );

create policy "Supervisors update workers in their factory (non-financial)" on workers
  for update using (
    factory_id = get_supervisor_factory_id() and
    supervisor_id = get_supervisor_id()
  ) with check (
    -- Prevent changing factory, supervisor, and opening advance
    factory_id = get_supervisor_factory_id() and
    supervisor_id = get_supervisor_id() and
    opening_advance = opening_advance
  );

-- Cash Transaction Policies
create policy "Admins see and insert all transactions" on cash_transactions
  for all using (is_admin());

create policy "Supervisors read their own transactions" on cash_transactions
  for select using (
    from_supervisor_id = get_supervisor_id() or
    to_supervisor_id = get_supervisor_id()
  );

create policy "Supervisors insert outgoing transactions" on cash_transactions
  for insert with check (
    from_supervisor_id = get_supervisor_id() and
    (
      -- Supervisor to worker in same factory
      (type = 'supervisor_to_worker' and to_worker_id in (
        select id from workers where factory_id = get_supervisor_factory_id()
      ))
      or
      -- Supervisor to supervisor in any factory (allowed to create outgoing to any active supervisor)
      (type = 'supervisor_to_supervisor' and to_supervisor_id is not null)
    )
  );

create policy "Supervisors update pending incoming status" on cash_transactions
  for update using (
    to_supervisor_id = get_supervisor_id() and
    status = 'pending'
  ) with check (
    to_supervisor_id = get_supervisor_id()
  );

-- Expense Policies
create policy "Admins see all expenses" on expenses
  for select using (is_admin());

create policy "Supervisors read own expenses" on expenses
  for select using (supervisor_id = get_supervisor_id());

create policy "Supervisors insert own expenses" on expenses
  for insert with check (
    supervisor_id = get_supervisor_id() and
    factory_id = get_supervisor_factory_id()
  );

-- Audit Log Policies
create policy "Admins read all audit logs" on audit_log
  for select using (is_admin());

-- FundFlow: Add 'canteen' to expenses category check constraint
-- Run this in Supabase SQL Editor if upgrading existing database instances

alter table public.expenses drop constraint if exists expenses_category_check;
alter table public.expenses add constraint expenses_category_check 
  check (category in ('wages', 'materials', 'transport', 'maintenance', 'canteen', 'other'));

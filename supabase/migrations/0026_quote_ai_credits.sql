-- Counts how many customer messages the AI reads for each business each month,
-- so a plan's AI credits (quote_plan_features, migration 0025) can be enforced.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0025_quote_plan_features.sql), BEFORE setting QUOTE_PLAN_FEATURES=true.
--
-- One credit = one customer message read by the AI. Months are Lagos calendar
-- months, stored as their first day (e.g. 2026-10-01).

create table if not exists public.quote_ai_usage (
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  month        date not null,
  credits_used integer not null default 0 check (credits_used >= 0),
  updated_at   timestamptz not null default now(),
  primary key (business_id, month)
);

alter table public.quote_ai_usage enable row level security;

-- Adds one credit and returns the new total for the month, in one step, so
-- two messages arriving together can't both slip past the limit.
create or replace function public.quote_use_ai_credit(p_business_id uuid, p_month date)
returns integer
language sql
as $$
  insert into public.quote_ai_usage as u (business_id, month, credits_used)
  values (p_business_id, p_month, 1)
  on conflict (business_id, month)
  do update set credits_used = u.credits_used + 1, updated_at = now()
  returning credits_used;
$$;

revoke all on function public.quote_use_ai_credit(uuid, date) from public, anon, authenticated;
grant execute on function public.quote_use_ai_credit(uuid, date) to service_role;

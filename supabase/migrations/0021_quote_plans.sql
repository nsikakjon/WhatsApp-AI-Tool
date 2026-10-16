-- Plans for the quote and order bot, including a free plan.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql), BEFORE setting QUOTE_PLAN on Railway.
--
-- Nothing changes for a business until it is put on a plan: business #1 (the
-- main number) with QUOTE_PLAN on Railway, every other business with the
-- plan_code column on its quote_businesses row.
-- The free plan takes up to 50 confirmed orders a month and adds a small
-- "Powered by yarnOga" line to quotes and confirmations. Paid plans have no
-- order limit and no credit line.
--
-- Prices are in kobo (₦1 = 100 kobo). Change them here, never in code.

create table if not exists public.quote_plans (
  code                 text primary key,
  name                 text not null,
  monthly_price_kobo   bigint not null check (monthly_price_kobo >= 0),
  -- Price per month when the plan is paid a year at a time. Null = no yearly price.
  monthly_price_paid_yearly_kobo bigint check (monthly_price_paid_yearly_kobo >= 0),
  setup_fee_kobo       bigint not null default 0 check (setup_fee_kobo >= 0),
  -- Confirmed orders allowed per calendar month (Lagos time). Null = no limit.
  monthly_order_limit  integer check (monthly_order_limit >= 0),
  -- Adds "Powered by yarnOga" under quotes and order confirmations.
  show_credit          boolean not null default false,
  -- Shown to owners as an upgrade option.
  active               boolean not null default true,
  sort_order           integer not null default 0
);

insert into public.quote_plans
  (code, name, monthly_price_kobo, monthly_price_paid_yearly_kobo, setup_fee_kobo, monthly_order_limit, show_credit, sort_order)
values
  ('free',        'Free',        0,       null,   0,        50,   true,  0),
  ('first_three', 'First three', 1500000, null,   5000000,  null, false, 1),
  ('starter',     'Starter',     750000,  600000, 7500000,  null, false, 2),
  ('standard',    'Standard',    4500000, null,   10000000, null, false, 3)
on conflict (code) do nothing;

-- Which plan each business is on. Empty = no plan limits.
alter table public.quote_businesses
  add column if not exists plan_code text references public.quote_plans(code);

-- Counting each business's confirmed orders this month.
create index if not exists quote_orders_business_confirmed_at_idx
  on public.quote_orders (business_id, confirmed_at);

alter table public.quote_plans enable row level security;

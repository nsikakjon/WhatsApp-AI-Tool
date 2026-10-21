-- New quote bot plans and prices (jay, 21 October 2026): Free, Starter, Pro,
-- Growth and Enterprise. Standard (₦45,000) is retired.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0025_quote_plan_features.sql and 0033_quote_plan_payments.sql).
--
-- Prices are in kobo (₦1 = 100 kobo). Change them here, never in code.
--
--              monthly    paid yearly (per month)
--   Free       ₦0         -
--   Starter    ₦7,000     ₦6,250
--   Pro        ₦23,000    ₦19,250
--   Growth     ₦73,000    ₦61,750
--   Enterprise ₦298,000   ₦253,000

-- One line on what each plan adds, shown when an owner sends "plan".
alter table public.quote_plans add column if not exists description text;

insert into public.quote_plans
  (code, name, monthly_price_kobo, monthly_price_paid_yearly_kobo, monthly_order_limit, show_credit, sort_order, description)
values
  ('pro',        'Pro',        2300000,  1925000,  null, false, 3, 'delivery and riders, broadcasts, order board and sales dashboard'),
  ('growth',     'Growth',     7300000,  6175000,  null, false, 4, 'up to 3 branches, more AI replies and broadcasts, set up for you'),
  ('enterprise', 'Enterprise', 29800000, 25300000, null, false, 5, 'the most AI replies and broadcasts, set up and support to suit you')
on conflict (code) do nothing;

update public.quote_plans set monthly_price_kobo = 700000, monthly_price_paid_yearly_kobo = 625000, sort_order = 1,
  description = 'unlimited orders, voice notes, invoices, reminders and the staff inbox'
  where code = 'starter';
update public.quote_plans set description = '50 orders a month' where code = 'free';

-- Standard can't be bought any more. A business already on it keeps it and
-- gets what Pro has (rows below), so nothing it uses is taken away.
update public.quote_plans set active = false, sort_order = 9 where code = 'standard';

-- What each plan includes. New features:
--   delivery         delivery zones, riders and tracking pages (QUOTE_DELIVERY must be on too).
--   order_board      the order board (new, paid, in production, out for delivery, delivered).
--   sales_dashboard  quotes, orders, revenue and AI replies for the business.
--   catalogue        product photos and stock levels.
--   branches         usage_limit = how many numbers (the business and its branches) it can have.
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
values
  ('free',       'delivery',        false, null),
  ('free',       'order_board',     false, null),
  ('free',       'sales_dashboard', false, null),
  ('free',       'catalogue',       false, null),
  ('free',       'branches',        true,  1),

  ('starter',    'delivery',        false, null),
  ('starter',    'order_board',     false, null),
  ('starter',    'sales_dashboard', false, null),
  ('starter',    'catalogue',       false, null),
  ('starter',    'branches',        true,  1),

  ('pro',        'ai_credits',      true,  7500),
  ('pro',        'products',        true,  null),
  ('pro',        'voice_notes',     true,  null),
  ('pro',        'invoices',        true,  null),
  ('pro',        'staff_inbox',     true,  null),
  ('pro',        'follow_ups',      true,  null),
  ('pro',        'broadcasts',      true,  1000),
  ('pro',        'test_screen',     true,  null),
  ('pro',        'delivery',        true,  null),
  ('pro',        'order_board',     true,  null),
  ('pro',        'sales_dashboard', true,  null),
  ('pro',        'catalogue',       true,  null),
  ('pro',        'branches',        true,  1),

  ('growth',     'ai_credits',      true,  25000),
  ('growth',     'products',        true,  null),
  ('growth',     'voice_notes',     true,  null),
  ('growth',     'invoices',        true,  null),
  ('growth',     'staff_inbox',     true,  null),
  ('growth',     'follow_ups',      true,  null),
  ('growth',     'broadcasts',      true,  5000),
  ('growth',     'test_screen',     true,  null),
  ('growth',     'delivery',        true,  null),
  ('growth',     'order_board',     true,  null),
  ('growth',     'sales_dashboard', true,  null),
  ('growth',     'catalogue',       true,  null),
  ('growth',     'branches',        true,  3),

  ('enterprise', 'ai_credits',      true,  100000),
  ('enterprise', 'products',        true,  null),
  ('enterprise', 'voice_notes',     true,  null),
  ('enterprise', 'invoices',        true,  null),
  ('enterprise', 'staff_inbox',     true,  null),
  ('enterprise', 'follow_ups',      true,  null),
  ('enterprise', 'broadcasts',      true,  20000),
  ('enterprise', 'test_screen',     true,  null),
  ('enterprise', 'delivery',        true,  null),
  ('enterprise', 'order_board',     true,  null),
  ('enterprise', 'sales_dashboard', true,  null),
  ('enterprise', 'catalogue',       true,  null),
  ('enterprise', 'branches',        true,  null),

  ('standard',   'delivery',        true,  null),
  ('standard',   'order_board',     true,  null),
  ('standard',   'sales_dashboard', true,  null),
  ('standard',   'catalogue',       true,  null),
  ('standard',   'branches',        true,  1)
on conflict (plan_code, feature) do nothing;

-- New AI reply allowances for the plans that already had rows.
update public.quote_plan_features set usage_limit = 500  where plan_code = 'free'    and feature = 'ai_credits';
update public.quote_plan_features set usage_limit = 2500 where plan_code = 'starter' and feature = 'ai_credits';

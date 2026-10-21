-- Paying for a quote bot plan in the chat (owner sends "upgrade starter").
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0021_quote_plans.sql and 0032_payments.sql).
--
-- When a Paystack payment for a plan goes through, the business's plan_code is
-- set and plan_paid_until says how long it lasts. After that date the
-- business is back on the free plan until it pays again. A plan_code set by
-- hand (with no date) never runs out.

alter table public.quote_businesses
  add column if not exists plan_paid_until timestamptz;

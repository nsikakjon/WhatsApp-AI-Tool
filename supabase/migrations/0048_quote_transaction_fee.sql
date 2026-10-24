-- yarnOga's fee on payments made through quote bot pay links (jay, 24 October
-- 2026): 2.5% of each payment, taken by Paystack when it splits the payment,
-- so the business gets the rest straight into its bank account as before.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0025 and 0034). Running it again is safe.
--
-- usage_limit is the fee in hundredths of a percent: 250 = 2.5%. Change it
-- here per plan, never in code. A plan without this row pays no fee.
-- Only pay-link payments carry the fee; cash and direct bank transfers to
-- the business never pass through yarnOga.

insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
values
  ('free',       'transaction_fee', true, 250),
  ('starter',    'transaction_fee', true, 250),
  ('standard',   'transaction_fee', true, 250),
  ('pro',        'transaction_fee', true, 250),
  ('growth',     'transaction_fee', true, 250),
  ('enterprise', 'transaction_fee', true, 250)
on conflict (plan_code, feature) do nothing;

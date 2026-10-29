-- Run this once in Supabase (SQL Editor > New query > paste > Run), after 0051. Running it again is safe.
--
-- CFA franc payments through Flutterwave (Mobile Money and cards), and a cap
-- on yarnOga's 2.5% transaction fee.
--
-- payments: which provider took the payment and in what currency. Existing
-- rows are naira payments through Paystack. Amounts stay in hundredths
-- (kobo, or centimes for CFA francs, always whole francs).
alter table public.payments add column if not exists currency text not null default 'NGN'
  check (currency in ('NGN', 'XOF', 'XAF'));
alter table public.payments add column if not exists provider text not null default 'paystack'
  check (provider in ('paystack', 'flutterwave'));
alter table public.payments add column if not exists flutterwave_id text;

-- Where a CFA franc business's pay links pay out: its Flutterwave subaccount
-- (RS_...), set up by yarnOga in the Flutterwave dashboard with the owner's
-- Mobile Money or bank account.
alter table public.quote_businesses add column if not exists flutterwave_subaccount text
  check (flutterwave_subaccount is null or flutterwave_subaccount ~ '^RS_[A-Za-z0-9]+$');

-- The most yarnOga's fee can be on one payment: N2,000 (200000 kobo) in
-- naira, and its rough equivalent of 800 FCFA (80000 centimes) in CFA francs.
-- Change usage_limit here to change a cap; the fee itself is transaction_fee
-- (250 = 2.5%, migration 0048).
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
select code, f.feature, true, f.cap
from public.quote_plans
cross join (values ('transaction_fee_cap_ngn', 200000), ('transaction_fee_cap_cfa', 80000)) as f(feature, cap)
on conflict (plan_code, feature) do nothing;

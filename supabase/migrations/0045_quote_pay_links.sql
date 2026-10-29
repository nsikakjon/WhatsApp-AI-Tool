-- Pay links on quote invoices: each business's Paystack subaccount, where the
-- money from its pay links goes (straight to the business's bank account).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql). Running it again is safe.
-- Nothing uses it until QUOTE_PAY_LINKS=true.

alter table public.quote_businesses
  add column if not exists paystack_subaccount text
  check (paystack_subaccount ~ '^ACCT_[A-Za-z0-9]+$');

comment on column public.quote_businesses.paystack_subaccount is
  'Paystack subaccount code (ACCT_...). Invoices get a pay link only when this is set and QUOTE_PAY_LINKS is on.';

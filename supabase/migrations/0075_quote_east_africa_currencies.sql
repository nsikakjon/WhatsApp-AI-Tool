-- Run this once in Supabase (SQL Editor > New query > paste > Run), after 0074. Running it again is safe.
--
-- A quote business can price in Kenyan, Ugandan or Tanzanian shillings,
-- Rwandan francs or Malawian kwacha, as well as naira and CFA francs. Amounts
-- stay whole hundredths in the same columns (cents), and prices outside naira
-- are whole units, so they end in 00. Pay links in these currencies go through
-- the business's Flutterwave subaccount (M-Pesa, Mobile Money or card).
alter table public.quote_businesses drop constraint if exists quote_businesses_currency_check;
alter table public.quote_businesses add constraint quote_businesses_currency_check
  check (currency in ('NGN', 'XOF', 'XAF', 'KES', 'UGX', 'TZS', 'RWF', 'MWK'));

-- yarnOga's balance sheet on the owner dashboard (Money tab > Balance sheet).
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Running it again is safe and changes nothing.
--
-- Each row is something yarnOga owns (money in Moniepoint, the Paystack and
-- Flutterwave balances, money someone owes us) or owes (a bill not yet paid,
-- a loan), typed in by the owner and updated when it changes. The shops'
-- payout balances are added from payout_ledger, not typed here.
--
-- Money is whole kobo (₦1 = 100 kobo). A dollar amount keeps the cents plus
-- the rate used, and amount_kobo is the naira value the totals add up.

create table if not exists public.balance_items (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- cash: money in a bank or payment account; owed_to_us: money someone owes
  -- yarnOga; owned: anything else of value. bill, loan, owed: money yarnOga owes.
  kind text not null check (kind in ('cash', 'owed_to_us', 'owned', 'bill', 'loan', 'owed')),
  item text not null,
  -- What it was worth or came to, in the currency it's in: kobo for NGN, cents for USD.
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency in ('NGN', 'USD')),
  -- For USD only: kobo per $1 (₦1,370 = 137000).
  usd_rate_kobo bigint check (usd_rate_kobo > 0),
  amount_kobo bigint not null check (amount_kobo >= 0),
  -- The day the amount was checked, e.g. the date on the bank app.
  as_of date not null,
  notes text,
  check ((currency = 'USD') = (usd_rate_kobo is not null))
);

-- Only the app (service role) can read or write it.
alter table public.balance_items enable row level security;

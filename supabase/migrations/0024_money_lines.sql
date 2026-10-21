-- Profit and loss for yarnOga, shown on the owner dashboard.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Running it again is safe: nothing is duplicated.
--
-- Each row is one amount of money in or out of yarnOga: a cost (Hostinger,
-- Railway, Claude) or income (a plan payment, a setup fee). New rows are added
-- from the dashboard's "Add an entry" form.
--
-- Money is whole kobo (₦1 = 100 kobo). A dollar cost keeps what was actually
-- paid in cents plus the rate used, and amount_kobo is the naira value that
-- every total on the dashboard adds up.

create table if not exists public.money_lines (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- The day the money went out or came in.
  entry_date date not null,
  kind text not null check (kind in ('income', 'expense')),
  item text not null,
  -- Who was paid, or who paid us.
  supplier text,
  category text,
  -- What was paid, in the currency it was paid in: kobo for NGN, cents for USD.
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency in ('NGN', 'USD')),
  -- For USD only: kobo per $1 used to work out amount_kobo (₦1,370 = 137000).
  usd_rate_kobo bigint check (usd_rate_kobo > 0),
  amount_kobo bigint not null check (amount_kobo >= 0),
  notes text,
  -- Marks rows copied from the spreadsheet ledger, so the copy runs only once.
  import_ref text unique,
  check ((currency = 'USD') = (usd_rate_kobo is not null))
);

create index if not exists money_lines_entry_date_idx on public.money_lines (entry_date);

-- Only the app (service role) can read or write it.
alter table public.money_lines enable row level security;

-- One-off copy of the costs already in accounts/yarnoga-ledger.xlsx (Expenses
-- tab, rows marked Paid), at the ledger's rate of ₦1,370 to $1. The Supabase
-- free period cost nothing, so it isn't copied.
insert into public.money_lines
  (entry_date, kind, item, supplier, category, amount_minor, currency, usd_rate_kobo, amount_kobo, notes, import_ref)
values
  ('2026-10-11', 'expense', 'Domain yarnoga.com (1 year)', 'Hostinger', 'Setup', 2018, 'USD', 137000, 2764660, 'Renews yearly on 11 Oct 2027', 'ledger-2026-10-11-domain'),
  ('2026-10-11', 'expense', 'Web hosting (1 month)', 'Hostinger', 'Setup', 999, 'USD', 137000, 1368630, 'Renews monthly', 'ledger-2026-10-11-hosting'),
  ('2026-10-11', 'expense', 'Claude API credits', 'Anthropic (Claude console)', 'Setup', 500, 'USD', 137000, 685000, 'Prepaid top-up', 'ledger-2026-10-11-claude-credits'),
  ('2026-10-11', 'expense', 'Bot hosting', 'Railway', 'Setup', 500, 'USD', 137000, 685000, 'Hobby plan, $5 a month', 'ledger-2026-10-11-railway'),
  ('2026-10-11', 'expense', 'Claude Pro plan (Claude Code)', 'Anthropic', 'Recurring', 2000, 'USD', 137000, 2740000, 'Standard Pro price, confirm on receipt', 'ledger-2026-10-11-claude-pro')
on conflict (import_ref) do nothing;

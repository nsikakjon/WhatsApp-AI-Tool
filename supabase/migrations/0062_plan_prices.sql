-- yarnOga's own plans paid in other currencies (docs/PAYMENTS.md).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0061). Running it again is safe, and puts the prices below back.
--
-- plan_prices: fixed prices for each plan in each currency, approved by jay
-- on 30 October 2026 (about 20% above the exchange rate; cedis are the naira
-- price divided by 100). The same prices are on the website's currency
-- picker (js/currency.js). Naira prices stay in quote_plans and flyer_plans.
-- Amounts are hundredths: pesewas, centimes or cents. XOF and XAF are worth
-- the same, so both get the same numbers.
--
-- Someone paying from a Ghana, Kenya or CFA franc country number is charged
-- in that currency, anyone else outside Nigeria in US dollars, as long as
-- PLAN_CURRENCIES lists the currency. Otherwise they pay in naira as before.

alter table public.payments drop constraint if exists payments_currency_check;
alter table public.payments add constraint payments_currency_check
  check (currency in ('NGN', 'XOF', 'XAF', 'GHS', 'KES', 'USD'));

create table if not exists public.plan_prices (
  product text not null check (product in ('quote', 'flyer')),
  plan_code text not null,
  currency text not null check (currency in ('XOF', 'XAF', 'GHS', 'KES', 'USD')),
  monthly_price_minor bigint not null check (monthly_price_minor > 0),
  monthly_price_paid_yearly_minor bigint check (monthly_price_paid_yearly_minor > 0),
  primary key (product, plan_code, currency)
);

alter table public.plan_prices enable row level security;

insert into public.plan_prices (product, plan_code, currency, monthly_price_minor, monthly_price_paid_yearly_minor)
select p.product, p.plan_code, c.currency, p.monthly, p.yearly
from (values
  ('quote', 'starter',    'GHS',      7000,     6200),
  ('quote', 'pro',        'GHS',     23000,    19000),
  ('quote', 'growth',     'GHS',     73000,    62000),
  ('quote', 'enterprise', 'GHS',    298000,   253000),
  ('quote', 'starter',    'CFA',    350000,   310000),
  ('quote', 'pro',        'CFA',   1200000,  1000000),
  ('quote', 'growth',     'CFA',   3700000,  3150000),
  ('quote', 'enterprise', 'CFA',  15000000, 12700000),
  ('quote', 'starter',    'KES',     85000,    75000),
  ('quote', 'pro',        'KES',    265000,   220000),
  ('quote', 'growth',     'KES',    850000,   720000),
  ('quote', 'enterprise', 'KES',   3500000,  2950000),
  ('quote', 'starter',    'USD',       600,      550),
  ('quote', 'pro',        'USD',      2000,     1700),
  ('quote', 'growth',     'USD',      6500,     5500),
  ('quote', 'enterprise', 'USD',     27000,    23000),
  ('flyer', 'standard',   'GHS',      4500,     2500),
  ('flyer', 'premium',    'GHS',      8000,     6500),
  ('flyer', 'deluxe',     'GHS',     10000,     8500),
  ('flyer', 'standard',   'CFA',    250000,   140000),
  ('flyer', 'premium',    'CFA',    400000,   325000),
  ('flyer', 'deluxe',     'CFA',    500000,   425000),
  ('flyer', 'standard',   'KES',     55000,    30000),
  ('flyer', 'premium',    'KES',     95000,    75000),
  ('flyer', 'deluxe',     'KES',    120000,   100000),
  ('flyer', 'standard',   'USD',       350,      250),
  ('flyer', 'premium',    'USD',       700,      600),
  ('flyer', 'deluxe',     'USD',       900,      800)
) as p(product, plan_code, cur, monthly, yearly)
join (values ('GHS', 'GHS'), ('KES', 'KES'), ('USD', 'USD'), ('CFA', 'XOF'), ('CFA', 'XAF')) as c(cur, currency) on c.cur = p.cur
on conflict (product, plan_code, currency) do update
  set monthly_price_minor = excluded.monthly_price_minor,
      monthly_price_paid_yearly_minor = excluded.monthly_price_paid_yearly_minor;

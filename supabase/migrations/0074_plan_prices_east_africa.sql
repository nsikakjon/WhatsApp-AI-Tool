-- Run this once in Supabase (SQL Editor > New query > paste > Run), after 0062. Running it again is safe.
--
-- yarnOga plans paid in Rwandan francs, Ugandan and Tanzanian shillings and
-- Malawian kwacha, through Flutterwave (Mobile Money and cards). The prices
-- follow the Kenyan ones (about 20% over the exchange rate), rounded, and are
-- the same as the website's currency picker (js/currency.js). Amounts are
-- hundredths, like every other price: 950000 means RWF 9,500.
alter table public.payments drop constraint if exists payments_currency_check;
alter table public.payments add constraint payments_currency_check
  check (currency in ('NGN', 'XOF', 'XAF', 'GHS', 'KES', 'RWF', 'UGX', 'TZS', 'MWK', 'USD'));

alter table public.plan_prices drop constraint if exists plan_prices_currency_check;
alter table public.plan_prices add constraint plan_prices_currency_check
  check (currency in ('XOF', 'XAF', 'GHS', 'KES', 'RWF', 'UGX', 'TZS', 'MWK', 'USD'));

insert into public.plan_prices (product, plan_code, currency, monthly_price_minor, monthly_price_paid_yearly_minor)
select product, plan_code, currency, monthly * 100, yearly * 100
from (values
  ('quote', 'starter',    'RWF',    9500,    8500),
  ('quote', 'pro',        'RWF',   30000,   25000),
  ('quote', 'growth',     'RWF',   95000,   80000),
  ('quote', 'enterprise', 'RWF',  390000,  330000),
  ('flyer', 'standard',   'RWF',    6000,    3500),
  ('flyer', 'premium',    'RWF',   11000,    8500),
  ('flyer', 'deluxe',     'RWF',   13000,   11000),
  ('quote', 'starter',    'UGX',   24000,   21000),
  ('quote', 'pro',        'UGX',   75000,   62000),
  ('quote', 'growth',     'UGX',  240000,  200000),
  ('quote', 'enterprise', 'UGX',  990000,  830000),
  ('flyer', 'standard',   'UGX',   16000,    8500),
  ('flyer', 'premium',    'UGX',   27000,   21000),
  ('flyer', 'deluxe',     'UGX',   34000,   28000),
  ('quote', 'starter',    'TZS',   17000,   15000),
  ('quote', 'pro',        'TZS',   52000,   43000),
  ('quote', 'growth',     'TZS',  170000,  140000),
  ('quote', 'enterprise', 'TZS',  690000,  580000),
  ('flyer', 'standard',   'TZS',   11000,    6000),
  ('flyer', 'premium',    'TZS',   19000,   15000),
  ('flyer', 'deluxe',     'TZS',   24000,   20000),
  ('quote', 'starter',    'MWK',   12000,   10000),
  ('quote', 'pro',        'MWK',   36000,   30000),
  ('quote', 'growth',     'MWK',  120000,  100000),
  ('quote', 'enterprise', 'MWK',  470000,  400000),
  ('flyer', 'standard',   'MWK',    7500,    4000),
  ('flyer', 'premium',    'MWK',   13000,   10000),
  ('flyer', 'deluxe',     'MWK',   16000,   14000)
) as p(product, plan_code, currency, monthly, yearly)
on conflict (product, plan_code, currency) do update
  set monthly_price_minor = excluded.monthly_price_minor,
      monthly_price_paid_yearly_minor = excluded.monthly_price_paid_yearly_minor;

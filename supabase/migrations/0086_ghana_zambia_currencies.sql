-- Run this once in Supabase (SQL Editor > New query > paste > Run), after 0075. Running it again is safe.
--
-- Flutterwave now takes Mobile Money in Ghana and Zambia (and CFA Mobile Money,
-- which was already allowed here). This lets shops price in Ghana cedis (GHS)
-- and Zambian kwacha (ZMW), and lets yarnOga plans be paid in kwacha. Plans in
-- cedis and CFA francs already have prices from 0062. The kwacha prices follow
-- the Kenyan ones at the exchange rate, rounded. Amounts are hundredths, like
-- every other price: 17000 means K170.
alter table public.quote_businesses drop constraint if exists quote_businesses_currency_check;
alter table public.quote_businesses add constraint quote_businesses_currency_check
  check (currency in ('NGN', 'XOF', 'XAF', 'GHS', 'ZMW', 'KES', 'UGX', 'TZS', 'RWF', 'MWK'));

alter table public.payments drop constraint if exists payments_currency_check;
alter table public.payments add constraint payments_currency_check
  check (currency in ('NGN', 'XOF', 'XAF', 'GHS', 'ZMW', 'KES', 'RWF', 'UGX', 'TZS', 'MWK', 'USD'));

alter table public.plan_prices drop constraint if exists plan_prices_currency_check;
alter table public.plan_prices add constraint plan_prices_currency_check
  check (currency in ('XOF', 'XAF', 'GHS', 'ZMW', 'KES', 'RWF', 'UGX', 'TZS', 'MWK', 'USD'));

insert into public.plan_prices (product, plan_code, currency, monthly_price_minor, monthly_price_paid_yearly_minor)
select product, plan_code, currency, monthly * 100, yearly * 100
from (values
  ('quote', 'starter',    'ZMW',   170,   150),
  ('quote', 'pro',        'ZMW',   530,   440),
  ('quote', 'growth',     'ZMW',  1700,  1450),
  ('quote', 'enterprise', 'ZMW',  7000,  5900),
  ('flyer', 'standard',   'ZMW',   110,    60),
  ('flyer', 'premium',    'ZMW',   190,   150),
  ('flyer', 'deluxe',     'ZMW',   240,   200)
) as p(product, plan_code, currency, monthly, yearly)
on conflict (product, plan_code, currency) do update
  set monthly_price_minor = excluded.monthly_price_minor,
      monthly_price_paid_yearly_minor = excluded.monthly_price_paid_yearly_minor;

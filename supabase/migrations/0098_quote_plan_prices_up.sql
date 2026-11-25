-- Run this once in Supabase (SQL Editor > New query > paste > Run). Running it again is safe.
--
-- New quote bot prices (jay, 25 Nov 2026): Starter goes to ₦15,000 and every
-- plan from Pro up goes up by ₦20,000 a month. Paid yearly is about 15% off.
--
--              Monthly    Paid yearly (per month)
--   Starter    ₦15,000    ₦12,750
--   Pro        ₦43,000    ₦36,500
--   Growth     ₦93,000    ₦79,000
--   Enterprise ₦318,000   ₦270,000
--
-- The other currencies move by the same share as naira, rounded, and match the
-- website's currency picker (js/currency.js). Cedis stay the naira price
-- divided by 100. Amounts below are whole units; the table keeps hundredths.
-- A shop already on a plan pays the new price from its next renewal.

update public.quote_plans as q set monthly_price_kobo = v.monthly, monthly_price_paid_yearly_kobo = v.yearly
from (values
  ('starter',    1500000,  1275000),
  ('pro',        4300000,  3650000),
  ('growth',     9300000,  7900000),
  ('enterprise', 31800000, 27000000)
) as v(code, monthly, yearly)
where q.code = v.code;

insert into public.plan_prices (product, plan_code, currency, monthly_price_minor, monthly_price_paid_yearly_minor)
select 'quote', p.plan_code, c.currency, p.monthly * 100, p.yearly * 100
from (values
  ('starter',    'GHS',     150,     125),
  ('pro',        'GHS',     430,     365),
  ('growth',     'GHS',     930,     790),
  ('enterprise', 'GHS',    3180,    2700),
  ('starter',    'CFA',    7500,    6400),
  ('pro',        'CFA',   22500,   19000),
  ('growth',     'CFA',   47000,   40000),
  ('enterprise', 'CFA',  160000,  135000),
  ('starter',    'ZMW',     360,     310),
  ('pro',        'ZMW',     990,     840),
  ('growth',     'ZMW',    2150,    1850),
  ('enterprise', 'ZMW',    7450,    6350),
  ('starter',    'KES',    1800,    1550),
  ('pro',        'KES',    4950,    4200),
  ('growth',     'KES',   11000,    9350),
  ('enterprise', 'KES',   37500,   32000),
  ('starter',    'RWF',   20500,   17500),
  ('pro',        'RWF',   56000,   47500),
  ('growth',     'RWF',  120000,  100000),
  ('enterprise', 'RWF',  415000,  355000),
  ('starter',    'UGX',   51500,   44000),
  ('pro',        'UGX',  140000,  120000),
  ('growth',     'UGX',  305000,  260000),
  ('enterprise', 'UGX', 1050000,  890000),
  ('starter',    'TZS',   36500,   31000),
  ('pro',        'TZS',   97000,   82500),
  ('growth',     'TZS',  215000,  185000),
  ('enterprise', 'TZS',  735000,  625000),
  ('starter',    'MWK',   25500,   21500),
  ('pro',        'MWK',   67500,   57500),
  ('growth',     'MWK',  155000,  130000),
  ('enterprise', 'MWK',  500000,  425000),
  ('starter',    'USD',      13,      11),
  ('pro',        'USD',      37,      31),
  ('growth',     'USD',      85,      72),
  ('enterprise', 'USD',     290,     250)
) as p(plan_code, cur, monthly, yearly)
join (values ('GHS', 'GHS'), ('CFA', 'XOF'), ('CFA', 'XAF'), ('ZMW', 'ZMW'), ('KES', 'KES'), ('RWF', 'RWF'),
             ('UGX', 'UGX'), ('TZS', 'TZS'), ('MWK', 'MWK'), ('USD', 'USD')) as c(cur, currency) on c.cur = p.cur
on conflict (product, plan_code, currency) do update
  set monthly_price_minor = excluded.monthly_price_minor,
      monthly_price_paid_yearly_minor = excluded.monthly_price_paid_yearly_minor;

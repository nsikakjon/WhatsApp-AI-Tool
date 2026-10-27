-- Customer care features by plan (run after 0054).
-- Which plans include what (a plan without a row gets the feature):
--   Free:              About & opening hours (no row needed: everyone has it)
--   Starter:           + payment reminders, ratings, "order again"
--   Pro and up:        + morning summary, Customers page
--   (Low-stock alerts come with stock counting, the "catalogue" feature, from Pro.)
-- Standard can't be bought any more; businesses on it keep what Pro has.
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
values
  ('free',       'pay_reminders',  false, null),
  ('free',       'ratings',        false, null),
  ('free',       'order_again',    false, null),
  ('free',       'daily_summary',  false, null),
  ('free',       'customers_page', false, null),
  ('starter',    'pay_reminders',  true,  null),
  ('starter',    'ratings',        true,  null),
  ('starter',    'order_again',    true,  null),
  ('starter',    'daily_summary',  false, null),
  ('starter',    'customers_page', false, null),
  ('pro',        'pay_reminders',  true,  null),
  ('pro',        'ratings',        true,  null),
  ('pro',        'order_again',    true,  null),
  ('pro',        'daily_summary',  true,  null),
  ('pro',        'customers_page', true,  null),
  ('standard',   'pay_reminders',  true,  null),
  ('standard',   'ratings',        true,  null),
  ('standard',   'order_again',    true,  null),
  ('standard',   'daily_summary',  true,  null),
  ('standard',   'customers_page', true,  null),
  ('growth',     'pay_reminders',  true,  null),
  ('growth',     'ratings',        true,  null),
  ('growth',     'order_again',    true,  null),
  ('growth',     'daily_summary',  true,  null),
  ('growth',     'customers_page', true,  null),
  ('enterprise', 'pay_reminders',  true,  null),
  ('enterprise', 'ratings',        true,  null),
  ('enterprise', 'order_again',    true,  null),
  ('enterprise', 'daily_summary',  true,  null),
  ('enterprise', 'customers_page', true,  null)
on conflict (plan_code, feature) do nothing;

-- What the plans say in the "plan" message and on the upgrade page.
update public.quote_plans set description = 'unlimited orders, voice notes, invoices, reminders, payment reminders, ratings, order again, the staff inbox and walk-in orders with one pickup screen'
  where code = 'starter';
update public.quote_plans set description = 'delivery and riders, broadcasts, order board and sales dashboard, customer list, morning summary, low-stock alerts, kitchen and bar screens (up to 3)'
  where code = 'pro';

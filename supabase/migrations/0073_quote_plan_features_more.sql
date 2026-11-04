-- Which quote plans include the newer owner app features (jay, 4 Nov 2026).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0025 and 0034). Running it again is safe and changes nothing.
--
--   barcodes          scanning barcodes at the counter and on the price list
--   offline_till      the till that keeps selling without internet
--   tax_summary       the monthly Tax summary page
--   staff_roles       adding staff logins (manager, cashier, rider)
--   payouts           paying riders and staff from the app
--   monthly_payments  monthly payments from regular customers
--   ad_leads          the Ads page: which WhatsApp ads bring chats and orders
-- Counter sales stay on every plan, so they need no row.
-- Starter gets the first four, Pro and above get all seven. "standard" is the
-- retired plan that keeps Pro features. Safe to run again.

insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
select p.plan_code, f.feature,
       case
         when p.plan_code = 'free' then false
         when p.plan_code = 'starter' then f.feature in ('barcodes', 'offline_till', 'tax_summary', 'staff_roles')
         else true
       end,
       null
from (values ('free'), ('starter'), ('pro'), ('standard'), ('growth'), ('enterprise')) as p(plan_code)
cross join (values ('barcodes'), ('offline_till'), ('tax_summary'), ('staff_roles'), ('payouts'), ('monthly_payments'), ('ad_leads')) as f(feature)
on conflict (plan_code, feature) do nothing;

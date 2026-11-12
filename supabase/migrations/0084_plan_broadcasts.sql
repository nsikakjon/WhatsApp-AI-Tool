-- Broadcast messages each quote plan includes a month: Pro 50, Growth 200,
-- Enterprise 1,000 (they were 1,000 / 5,000 / 20,000, which cost more in
-- Meta charges than the plans earn). More is bought in message packs (0083).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0034). Running it again is safe and changes nothing.
--
-- Run it BEFORE switching broadcasts on (BROADCASTS_ENABLED): the plans now
-- get these messages automatically, with no broadcast_addons row needed. A
-- business with a broadcast_addons row keeps that row's number instead.
-- Standard can no longer be bought and goes with Pro.

update public.quote_plan_features set usage_limit = 50   where feature = 'broadcasts' and plan_code in ('pro', 'standard');
update public.quote_plan_features set usage_limit = 200  where feature = 'broadcasts' and plan_code = 'growth';
update public.quote_plan_features set usage_limit = 1000 where feature = 'broadcasts' and plan_code = 'enterprise';

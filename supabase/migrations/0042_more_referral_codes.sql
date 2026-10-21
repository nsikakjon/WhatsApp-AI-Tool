-- Lets a quote business have more than one referral code, e.g. HOLIDAYS.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0041_promo_codes.sql).
--
-- Owners make extra codes by sending "new code HOLIDAYS" to their bot. Each
-- works like their first code: 10% off for the business that uses it, and a
-- free month for the owner once that business pays.

alter table public.promo_codes drop constraint if exists promo_codes_referrer_business_id_key;

create index if not exists promo_codes_referrer_idx on public.promo_codes (referrer_business_id) where referrer_business_id is not null;

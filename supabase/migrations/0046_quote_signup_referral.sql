-- The sign-up chat asks "Do you have a referral code?" and keeps the answer,
-- so the business's first upgrade gets the code's discount without retyping it
-- (and the business that shared it gets its free month).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0039_quote_chat_signup.sql and 0041_promo_codes.sql). Safe to run again.

alter table public.quote_signups drop constraint if exists quote_signups_step_check;
alter table public.quote_signups
  add constraint quote_signups_step_check check (step in ('name', 'about', 'referral', 'prices', 'done'));

alter table public.quote_signups
  add column if not exists referral_code text references public.promo_codes (code) on delete set null;

alter table public.quote_businesses
  add column if not exists referral_code text references public.promo_codes (code) on delete set null;

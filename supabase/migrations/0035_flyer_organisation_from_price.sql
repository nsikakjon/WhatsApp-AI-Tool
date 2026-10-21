-- Flyer bot: Organisation is priced per organisation, starting at ₦73,000 a
-- month (jay, 21 October 2026). Other flyer prices don't change.
-- Run this once in Supabase: SQL Editor > New query > paste > Run (after 0011).
--
-- Organisation still has no fixed monthly price, so it can't be bought with
-- a payment link: the bot shows "from ₦73,000 a month" and the request goes
-- to the owners, who agree the price and switch the group on.
-- Prices are in kobo (₦1 = 100 kobo).

alter table public.flyer_plans
  add column if not exists starting_price_kobo bigint check (starting_price_kobo >= 0);

update public.flyer_plans set starting_price_kobo = 7300000 where id = 'organisation';

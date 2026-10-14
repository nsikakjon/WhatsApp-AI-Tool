-- New flyer plan prices and limits (jay, 2026-10-14).
-- Run this once in Supabase: SQL Editor > New query > paste > Run (after 0010).
-- Prices are in kobo (₦1 = 100 kobo). Member limits are in
-- src/products/flyer/plans.ts: Free 10, Standard 50, Premium 500, Deluxe and
-- Organisation unlimited.

-- Price per month when a plan is paid a year at a time. Null = no yearly price.
alter table public.flyer_plans
  add column if not exists monthly_price_paid_yearly_kobo bigint check (monthly_price_paid_yearly_kobo >= 0);

-- New Deluxe plan, between Premium and Organisation.
insert into public.flyer_plans (id, monthly_price_kobo, sort_order) values ('deluxe', 1000000, 4)
on conflict (id) do nothing;
-- Organisation stays "price on request", now listed after Deluxe.
update public.flyer_plans set sort_order = 5 where id = 'organisation';

update public.flyer_plans set monthly_price_kobo = 0,       monthly_price_paid_yearly_kobo = null    where id = 'free';
update public.flyer_plans set monthly_price_kobo = 450000,  monthly_price_paid_yearly_kobo = 250000  where id = 'standard';
update public.flyer_plans set monthly_price_kobo = 800000,  monthly_price_paid_yearly_kobo = 650000  where id = 'premium';
update public.flyer_plans set monthly_price_kobo = 1000000, monthly_price_paid_yearly_kobo = 850000  where id = 'deluxe';

-- Phase 3: paid plans for flyer groups.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0006). What each plan includes is in src/products/flyer/plans.ts;
-- the monthly prices are here, in kobo (₦1 = 100 kobo).

create table if not exists public.flyer_plans (
  id                 text primary key,
  -- Monthly price in kobo, e.g. 300000 = ₦3,000. Null means "price on request".
  monthly_price_kobo bigint check (monthly_price_kobo >= 0),
  sort_order         smallint not null default 0
);

insert into public.flyer_plans (id, monthly_price_kobo, sort_order) values
  ('free',         0,      1),
  ('standard',     300000, 2),
  ('premium',      750000, 3),
  ('organisation', null,   4)
on conflict (id) do nothing;

alter table public.flyer_plans enable row level security;

alter table public.flyer_groups
  -- The group's plan. New groups start on Free.
  add column if not exists plan text not null default 'free' references public.flyer_plans(id),
  -- When a paid plan runs out (the group drops back to Free). Null = never.
  add column if not exists plan_until timestamptz;

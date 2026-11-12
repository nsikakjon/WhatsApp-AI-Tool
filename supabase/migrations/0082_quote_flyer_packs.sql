-- Business flyers in the owner app: the Free plan's monthly allowance and
-- flyer packs (src/products/quote/flyer-packs.ts).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0025 and 0063). Running it again is safe and changes nothing.
--
-- Until this is run, every plan makes flyers with no limit.

-- How many flyers a plan makes a month. Free gets 3, with the yarnOga tag
-- and two designs; the paid plans have no limit. Change the number here,
-- never in code.
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
select p.plan_code, 'business_flyers', true, case when p.plan_code = 'free' then 3 else null end
from (values ('free'), ('starter'), ('pro'), ('standard'), ('growth'), ('enterprise')) as p(plan_code)
on conflict (plan_code, feature) do nothing;

-- The packs on sale. Prices in kobo (₦1 = 100 kobo). A pack's flyers have
-- every design and no yarnOga tag, and don't run out at the end of the month.
-- jay set the pack below on 12 Nov 2026: change or add rows here.
create table if not exists public.quote_flyer_packs (
  code        text primary key,
  name        text not null,
  flyers      integer not null check (flyers > 0),
  price_kobo  bigint not null check (price_kobo > 0),
  active      boolean not null default true,
  sort_order  integer not null default 0
);

alter table public.quote_flyer_packs enable row level security;

insert into public.quote_flyer_packs (code, name, flyers, price_kobo, sort_order)
values ('flyers-5', '5 flyers', 5, 300000, 1)
on conflict (code) do nothing;

-- One row per pack paid for. The Paystack reference is the key, so a retried
-- webhook can never add the same pack twice.
create table if not exists public.quote_flyer_topups (
  reference    text primary key references public.payments(reference),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  pack_code    text not null,
  flyers       integer not null check (flyers > 0),
  amount_kobo  bigint not null check (amount_kobo > 0),
  created_at   timestamptz not null default now()
);

create index if not exists quote_flyer_topups_business_idx on public.quote_flyer_topups (business_id);

alter table public.quote_flyer_topups enable row level security;

-- One row per flyer made: from the plan's monthly allowance, or from a pack.
create table if not exists public.quote_flyers_made (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  paid_by      text not null check (paid_by in ('plan', 'pack')),
  made_at      timestamptz not null default now()
);

create index if not exists quote_flyers_made_business_idx on public.quote_flyers_made (business_id, made_at);

alter table public.quote_flyers_made enable row level security;

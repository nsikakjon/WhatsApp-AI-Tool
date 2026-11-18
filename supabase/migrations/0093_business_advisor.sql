-- Business advisor in the owner app and the owner's WhatsApp
-- (src/owner/advisor/, QUOTE_BUSINESS_ADVISOR).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0025). Running it again is safe and changes nothing.
--
-- Until this is run, the advisor page says it can't save answers and the
-- WhatsApp "advice" command answers as if the switch were off.

-- Which plans get it, and how many written answers a month. Free and Starter
-- don't; Pro and the retired "standard" get 30, Growth 100, Enterprise 300.
-- A business with no plan (KahnPrints) gets it with no limit. Change the
-- numbers here, never in code.
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
select p.plan_code, 'business_advisor', p.plan_code not in ('free', 'starter'),
       case p.plan_code when 'pro' then 30 when 'standard' then 30 when 'growth' then 100 when 'enterprise' then 300 else null end
from (values ('free'), ('starter'), ('pro'), ('standard'), ('growth'), ('enterprise')) as p(plan_code)
on conflict (plan_code, feature) do nothing;

-- One row per answer. Asking the same question again within a few hours
-- shows the saved answer, so it costs nothing and counts once. Rows with
-- ai = true count towards the month's limit.
create table if not exists public.quote_advisor_answers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  question     text not null check (question in ('shop', 'lapsed', 'grow', 'prices', 'post')),
  answer       jsonb not null,
  ai           boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists quote_advisor_answers_business_idx on public.quote_advisor_answers (business_id, created_at desc);

alter table public.quote_advisor_answers enable row level security;

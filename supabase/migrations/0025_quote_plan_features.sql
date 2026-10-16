-- What each quote bot plan includes (Free, Starter, Standard).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0021_quote_plans.sql), BEFORE setting QUOTE_PLAN_FEATURES=true on Railway.
--
-- One row per plan and feature. "included" switches a feature on or off for
-- the plan; "usage_limit" caps how much of it the plan gets (null = no cap).
-- A feature with no row for a plan counts as included with no cap, so a new
-- feature changes nothing until rows are added for it here.
-- Nothing is enforced unless QUOTE_PLAN_FEATURES=true, and a business with no
-- plan (how KahnPrints runs) gets everything, as before.
--
-- Features (the code reads these names; see src/products/quote/features.ts):
--   ai_credits   AI-read customer messages per month (Lagos time). When they
--                run out, the bot keeps quoting with simple keyword matching.
--   products     price list rows (variants) the business can have.
--   voice_notes  customers can send voice notes.
--   invoices     invoice and receipt pictures with the business logo.
--   staff_inbox  the staff inbox (see chats, take over from the bot).
--   follow_ups   one polite reminder when a quote isn't paid.
--   broadcasts   messages to opted-in customers; usage_limit = messages a month.
--   test_screen  the owner test screen.
--
-- Change limits here, never in code.

create table if not exists public.quote_plan_features (
  plan_code    text not null references public.quote_plans(code) on delete cascade,
  feature      text not null,
  included     boolean not null default true,
  usage_limit  integer check (usage_limit >= 0),
  primary key (plan_code, feature)
);

alter table public.quote_plan_features enable row level security;

insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
values
  ('free',     'ai_credits',  true,  300),
  ('free',     'products',    true,  20),
  ('free',     'voice_notes', false, null),
  ('free',     'invoices',    false, null),
  ('free',     'staff_inbox', false, null),
  ('free',     'follow_ups',  false, null),
  ('free',     'broadcasts',  false, null),
  ('free',     'test_screen', true,  null),

  ('starter',  'ai_credits',  true,  3000),
  ('starter',  'products',    true,  100),
  ('starter',  'voice_notes', true,  null),
  ('starter',  'invoices',    true,  null),
  ('starter',  'staff_inbox', true,  null),
  ('starter',  'follow_ups',  true,  null),
  ('starter',  'broadcasts',  false, null),
  ('starter',  'test_screen', true,  null),

  ('standard', 'ai_credits',  true,  20000),
  ('standard', 'products',    true,  null),
  ('standard', 'voice_notes', true,  null),
  ('standard', 'invoices',    true,  null),
  ('standard', 'staff_inbox', true,  null),
  ('standard', 'follow_ups',  true,  null),
  ('standard', 'broadcasts',  true,  1000),
  ('standard', 'test_screen', true,  null)
on conflict (plan_code, feature) do nothing;

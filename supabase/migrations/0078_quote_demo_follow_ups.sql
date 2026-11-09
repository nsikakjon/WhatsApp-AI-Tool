-- One follow-up for people who chat to the yarnOga quotes number and go
-- quiet without signing up (QUOTE_DEMO_FOLLOW_UP=true).
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Running it again is safe.

create table if not exists public.quote_demo_follow_ups (
  -- The person. One row each, so nobody gets the follow-up twice.
  contact_id  uuid primary key references public.contacts(id) on delete cascade,
  sent_at     timestamptz not null default now()
);

alter table public.quote_demo_follow_ups enable row level security;

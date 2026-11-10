-- The door-to-door tally sheet on the owner dashboard (/dashboard/tally).
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Running it again is safe.
--
-- Each row is one shop visited on a walk-in sales day: what kind of shop it
-- is, whether the owner was in, and how far they got (interested, signed up,
-- live before we left), plus the day to go back if they said "not now".

create table if not exists public.door_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visit_date date not null,
  shop text not null,
  shop_type text,
  -- Where the shop is, e.g. "Admiralty Mall".
  place text,
  owner_in boolean not null default false,
  interested boolean not null default false,
  signed_up boolean not null default false,
  live boolean not null default false,
  follow_up_on date,
  notes text
);

create index if not exists door_visits_visit_date_idx on public.door_visits (visit_date);

-- Only the app (service role) can read or write it.
alter table public.door_visits enable row level security;

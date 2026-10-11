-- Real estate lead qualifier.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0001_contacts_and_messages.sql).
--
-- One row per person who enquires on the leads number: what they're looking
-- for, how serious they are (score), and whether an agent has been alerted.

create table if not exists public.lead_leads (
  id             uuid primary key default gen_random_uuid(),
  -- Their WhatsApp number in international format, digits only, e.g. 2348012345678.
  wa_id          text not null unique,
  name           text,
  -- 'buy' or 'rent'.
  purpose        text check (purpose in ('buy', 'rent')),
  -- e.g. "3 bedroom flat", "land", "duplex".
  property_type  text,
  -- e.g. "Lekki Phase 1", "Abuja, Gwarinpa".
  location       text,
  -- The most they said they can spend, in kobo (rent: per year). Whole numbers only.
  budget_kobo    bigint check (budget_kobo >= 0),
  timeline       text check (timeline in ('now', '1-3 months', '3-6 months', 'later', 'just looking')),
  financing      text check (financing in ('cash', 'mortgage approved', 'payment plan', 'needs mortgage', 'unsure')),
  -- True once they've asked to speak to a person or book a viewing.
  wants_agent    boolean not null default false,
  -- 0 to 100, worked out in code from the answers above.
  score          integer not null default 0,
  temperature    text not null default 'cold' check (temperature in ('hot', 'warm', 'cold')),
  -- 'qualifying' while questions are being asked, 'qualified' when all are
  -- answered, 'handed_off' once an agent has been alerted.
  status         text not null default 'qualifying' check (status in ('qualifying', 'qualified', 'handed_off')),
  -- When agents were alerted. Set only once, so a lead never triggers two alerts.
  alerted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists lead_leads_updated_idx on public.lead_leads (updated_at desc);

alter table public.lead_leads enable row level security;

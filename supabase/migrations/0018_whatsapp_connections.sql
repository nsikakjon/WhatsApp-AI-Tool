-- Numbers connected through the sign-up page (/signup, Meta "Embedded Signup"),
-- including numbers that stay in the WhatsApp Business app (coexistence).
-- Run this once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.whatsapp_connections (
  id                  uuid primary key default gen_random_uuid(),
  -- Meta's "Phone number ID" of the connected number (what Railway settings use).
  phone_number_id     text not null unique,
  -- The WhatsApp Business Account the number belongs to.
  waba_id             text not null,
  -- The number as people see it, e.g. +234 811 433 0749, and its display name.
  display_number      text,
  verified_name       text,
  -- True when the number stays in the WhatsApp Business app (coexistence).
  coexistence         boolean not null default false,
  -- Meta's key for sending from this business's number. Meta only hands it
  -- over once, at sign-up, so it is kept here. Secret: server-only table.
  business_token      text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Server-only, like the other tables.
alter table public.whatsapp_connections enable row level security;

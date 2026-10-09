-- Phase 0: the people who message us, and every message in and out.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  -- The customer's WhatsApp ID (their phone number in international format, digits only).
  wa_id       text not null unique,
  -- The name they've set on their WhatsApp profile, if shared.
  name        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  direction      text not null check (direction in ('inbound', 'outbound')),
  -- WhatsApp's own ID for the message. Unique, so if Meta sends the same
  -- webhook twice the second insert fails and we don't reply twice.
  wa_message_id  text unique,
  -- text, image, audio, document, etc.
  type           text not null,
  -- The text content, when there is one.
  body           text,
  -- The full message exactly as WhatsApp sent or returned it, for debugging.
  raw            jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists messages_contact_id_created_at_idx
  on public.messages (contact_id, created_at desc);

-- Lock both tables down. The server uses the service_role key, which bypasses
-- these rules; nobody else (e.g. someone holding the public anon key) can read them.
alter table public.contacts enable row level security;
alter table public.messages enable row level security;

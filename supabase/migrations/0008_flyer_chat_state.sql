-- Phase 3: remembers where someone is in a guided conversation with the flyer
-- bot: setting up a new group step by step, or writing a message to support.
-- Run this once in Supabase: SQL Editor > New query > paste > Run (after 0007).

create table if not exists public.flyer_chat_state (
  -- Their WhatsApp number, digits only.
  wa_id       text primary key,
  -- 'name', 'logo' or 'design' while setting up a group; 'support' while writing to support.
  step        text not null check (step in ('name', 'logo', 'design', 'support')),
  -- The group being set up, once it exists.
  group_id    uuid references public.flyer_groups(id) on delete cascade,
  updated_at  timestamptz not null default now()
);

alter table public.flyer_chat_state enable row level security;

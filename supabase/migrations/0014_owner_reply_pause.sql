-- WhatsApp coexistence: the business owner keeps using the WhatsApp Business
-- app on the same number as the bot. When the owner replies to a customer from
-- the app, the bot goes quiet in that chat for a while (OWNER_REPLY_PAUSE_MINUTES)
-- so the two don't talk over each other.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.chat_pauses (
  -- Meta's "Phone number ID" of our number (one row per number per customer,
  -- so a pause on one bot never silences another).
  business_number_id  text not null,
  -- The customer's WhatsApp ID (digits only).
  wa_id               text not null,
  -- The bot stays quiet in this chat until this time. Each owner reply pushes it later.
  paused_until        timestamptz not null,
  updated_at          timestamptz not null default now(),
  primary key (business_number_id, wa_id)
);

-- Server-only, like the other tables.
alter table public.chat_pauses enable row level security;

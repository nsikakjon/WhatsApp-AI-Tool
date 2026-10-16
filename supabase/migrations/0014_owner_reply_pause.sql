-- Lets a person take a chat over from the bot. Used by WhatsApp coexistence:
-- the business owner keeps using the WhatsApp Business app on the same number
-- as the bot, and when the owner replies to a customer from the app, the bot
-- goes quiet in that chat for a while (OWNER_REPLY_PAUSE_MINUTES) so the two
-- don't talk over each other. A web inbox "Take over" button can use it too.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.bot_pauses (
  -- The customer.
  contact_id          uuid not null references public.contacts(id) on delete cascade,
  -- Meta's "Phone number ID" of our number (one row per number per customer,
  -- so a pause on one bot never silences another).
  business_number_id  text not null,
  -- The bot stays quiet in this chat until this time. Empty means until a
  -- person hands the chat back.
  paused_until        timestamptz,
  -- Who paused it: 'phone' (owner replied from the WhatsApp Business app) or 'inbox'.
  paused_by           text not null,
  updated_at          timestamptz not null default now(),
  primary key (contact_id, business_number_id)
);

-- Server-only, like the other tables.
alter table public.bot_pauses enable row level security;

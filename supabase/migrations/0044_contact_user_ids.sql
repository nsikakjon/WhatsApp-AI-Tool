-- Keeps Meta's "business-scoped user ID" on each contact.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Running it again is safe.
--
-- WhatsApp is bringing in usernames. A customer with a username can hide their
-- phone number, and then Meta only sends us this ID (e.g. NG.1349120865530274).
-- Saving it next to the number lets a regular customer who later hides their
-- number keep the same chat, orders and history. Until this is run the bots
-- still answer such customers; they just start as a new contact.

alter table public.contacts add column if not exists user_id text;

create unique index if not exists contacts_user_id_key on public.contacts (user_id);

comment on column public.contacts.user_id is
  'Meta business-scoped user ID (BSUID). wa_id holds it too when the customer hides their number.';

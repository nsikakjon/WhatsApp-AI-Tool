-- Phone numbers shared by customers who hide theirs behind a WhatsApp username.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Running it again is safe.
--
-- A customer with a WhatsApp username can hide their number, and then we only
-- get an ID like NG.1349120865530274 (see 0044). When they order, the bot sends
-- a "Share your number" button; one tap sends us their number, saved here so
-- the owner can call them and the rider (or courier) can reach them.

alter table public.contacts add column if not exists phone text;

comment on column public.contacts.phone is
  'Phone number (digits only) a customer with a hidden number shared with us. Null when wa_id is already their number.';

alter table public.quote_deliveries add column if not exists customer_phone text;

comment on column public.quote_deliveries.customer_phone is
  'The customer''s shared phone number when their WhatsApp ID hides it, for the rider and courier.';

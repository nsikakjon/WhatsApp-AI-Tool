-- Staff inbox: a web page where staff read chats and take over from the bot.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0001_contacts_and_messages.sql).
--
-- 1. Each message remembers which of our WhatsApp numbers it went through, so
--    the inbox can keep a customer's chat with the sales number apart from
--    their chat with the flyer number. Messages saved before this have no
--    number; the inbox treats them as the main number (WHATSAPP_PHONE_NUMBER_ID).
-- 2. A view listing every chat (one customer on one of our numbers) with its
--    latest message, for the inbox's front page.

alter table public.messages add column if not exists business_number_id text;

create or replace view public.inbox_chats
with (security_invoker = true) as
select distinct on (m.contact_id, coalesce(m.business_number_id, ''))
  m.contact_id,
  m.business_number_id,
  c.wa_id,
  c.name,
  m.direction  as last_direction,
  m.type       as last_type,
  m.body       as last_body,
  m.created_at as last_at
from public.messages m
join public.contacts c on c.id = m.contact_id
order by m.contact_id, coalesce(m.business_number_id, ''), m.created_at desc;

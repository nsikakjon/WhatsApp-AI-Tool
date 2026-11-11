-- Oko WhatsApp alerts: a field's owner can switch on a daily WhatsApp message
-- when the field needs attention (black pod risk, heavy rain coming, the
-- satellite showing the field less green...). See docs/FARM.md.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0076 and 0077). Running it again is safe.

-- The owner's switch for each field. Off until they turn it on in Settings.
alter table public.farm_fields
  add column if not exists whatsapp_alerts boolean not null default false;

-- (farm_users.phone, from 0076, holds the owner's WhatsApp number.)

-- Every alert sent, so the same alert isn't sent again for a week.
create table if not exists public.farm_alerts_sent (
  id          bigint generated always as identity primary key,
  field_id    text not null references public.farm_fields(id) on delete cascade,
  -- The alert's title, e.g. "Black pod risk is high".
  alert_key   text not null,
  sent_to     text not null,
  sent_at     timestamptz not null default now()
);
create index if not exists farm_alerts_sent_field_idx on public.farm_alerts_sent (field_id, sent_at);

alter table public.farm_alerts_sent enable row level security;

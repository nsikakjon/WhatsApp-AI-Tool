-- Quote follow-ups: one polite reminder for a quote the customer never answered.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql). Nothing uses it until QUOTE_FOLLOW_UPS
-- is switched on in Railway (see docs/QUOTE_FOLLOW_UPS.md).

-- What happened to each quote's reminder. Empty means "not decided yet".
-- Once set it never changes back, so a quote can only ever get one reminder.
--   sent     the reminder went out (or was being sent)
--   skipped  no reminder: the customer replied, opted out, the chat was
--            taken over by staff, or they couldn't be reached
--   failed   WhatsApp refused the reminder
alter table public.quote_orders
  add column if not exists follow_up_status text
    check (follow_up_status in ('sent', 'skipped', 'failed')),
  add column if not exists follow_up_at timestamptz;

-- Finds quotes waiting for a reminder quickly.
create index if not exists quote_orders_follow_up_idx
  on public.quote_orders (business_id, created_at)
  where status = 'quoted' and follow_up_status is null;

-- Hours after a quote before the reminder goes (e.g. 24 = next day).
-- Empty uses the default (QUOTE_FOLLOW_UP_HOURS); 0 switches reminders off
-- for that business. Business #1 always uses QUOTE_FOLLOW_UP_HOURS.
alter table public.quote_businesses
  add column if not exists follow_up_hours integer
    check (follow_up_hours is null or follow_up_hours between 0 and 168);

-- Customers who replied STOP: they never get quote reminders from that business again.
create table if not exists public.quote_follow_up_opt_outs (
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  business_id uuid not null references public.quote_businesses(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (contact_id, business_id)
);

alter table public.quote_follow_up_opt_outs enable row level security;

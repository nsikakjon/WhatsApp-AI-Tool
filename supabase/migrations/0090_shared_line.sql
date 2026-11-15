-- Partners on yarnOga's quotes line (QUOTE_SIGNUP_PHONE_NUMBER_ID), for a shop
-- with no WhatsApp number of its own: a visitor who sends the shop's keyword
-- (e.g. "tedxuniuyo") chats with that shop's bot on our line until they send
-- "exit", another keyword, or go quiet for 14 days (src/products/quote/shared-line.ts).
-- Set the keyword from the dashboard's Partnerships page.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql). Running it again is safe.

alter table public.quote_businesses
  add column if not exists line_keyword text unique check (line_keyword ~ '^[a-z0-9]{3,30}$');

-- Each visitor to each shop on the line. The row with no left_at is the
-- shop they're talking to now; the rest count towards the event report.
create table if not exists public.quote_line_guests (
  wa_id       text not null,
  number_id   text not null,
  business_id uuid not null references public.quote_businesses (id) on delete cascade,
  last_at     timestamptz not null default now(),
  left_at     timestamptz,
  primary key (wa_id, number_id, business_id)
);

create index if not exists quote_line_guests_business_idx on public.quote_line_guests (business_id);

-- Only the app (service role) can read or write it.
alter table public.quote_line_guests enable row level security;

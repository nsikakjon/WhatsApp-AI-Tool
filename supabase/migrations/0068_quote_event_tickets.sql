-- Event tickets for the quote bot (QUOTE_EVENT_TICKETS, src/products/quote/tickets/).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020, 0025 and 0034). Running it again is safe and changes nothing.
--
-- A ticket is a price list product the owner marks with "ticket 3 on", e.g.
-- "Element House: Regular" and "Element House: VIP". Customers order and pay
-- for them like anything else (prices from the price list, pay link). Once
-- paid, every ticket bought gets its own QR code on WhatsApp, and the door
-- screen lets each one in once. To cap how many are sold, set the
-- product's stock ("stock" command, migration 0037).

alter table public.quote_products
  add column if not exists ticket boolean not null default false;

-- One row per ticket: an order for 3 VIP tickets makes seats 1, 2 and 3.
create table if not exists public.quote_event_tickets (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.quote_businesses(id) on delete cascade,
  order_id      uuid not null references public.quote_orders(id) on delete cascade,
  seat          integer not null check (seat > 0),
  -- The price list line, e.g. "Element House: VIP", copied in when the ticket is made.
  name          text not null,
  -- 4 digits the door can type with the order number ("214 4827") if the QR code won't scan.
  code          text not null check (code ~ '^[0-9]{4}$'),
  checked_in_at timestamptz,
  created_at    timestamptz not null default now(),
  unique (order_id, seat),
  unique (order_id, code)
);

create index if not exists quote_event_tickets_business_idx
  on public.quote_event_tickets (business_id, created_at desc);

alter table public.quote_event_tickets enable row level security;

-- What each plan includes: event_tickets = selling tickets with QR check-in at the door.
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
values
  ('free',       'event_tickets', false, null),
  ('starter',    'event_tickets', true,  null),
  ('pro',        'event_tickets', true,  null),
  ('standard',   'event_tickets', true,  null),
  ('growth',     'event_tickets', true,  null),
  ('enterprise', 'event_tickets', true,  null)
on conflict (plan_code, feature) do nothing;

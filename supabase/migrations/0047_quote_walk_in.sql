-- Walk-in orders for the quote bot: restaurants, bars and events where the
-- customer is already there. They order and pay in the chat, the kitchen or
-- bar sees the order on a screen, and the receipt carries a QR code that
-- staff scan when the customer collects (once only).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020, 0025 and 0034). Running it again is safe.
-- Nothing uses it until QUOTE_WALK_IN=true.

-- The owner turns walk-in orders on with "walk-in on", and pauses new orders
-- with "close orders" (e.g. last orders at the bar).
alter table public.quote_businesses
  add column if not exists walk_in boolean not null default false,
  add column if not exists orders_paused boolean not null default false;

-- Which screen makes each product, e.g. "Bar" or "Kitchen". Empty = the
-- single "Counter" screen. Saving a new price list keeps it.
alter table public.quote_products
  add column if not exists station text check (station is null or length(station) between 1 and 30);

-- Where to bring the order (a table or spot, when the customer sent one)
-- and the 4 digits staff can type instead of scanning the QR code.
alter table public.quote_orders
  add column if not exists table_label text check (table_label is null or length(table_label) between 1 and 20),
  add column if not exists pickup_code text check (pickup_code is null or pickup_code ~ '^[0-9]{4}$');

-- The table or spot a customer said they're at ("Table 7"), until their next order.
create table if not exists public.quote_walk_in_spots (
  business_id uuid not null references public.quote_businesses(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  label       text not null check (length(label) between 1 and 20),
  set_at      timestamptz not null default now(),
  primary key (business_id, contact_id)
);

-- One ticket per screen for each paid order: a drinks-and-food order makes
-- a Bar ticket and a Kitchen ticket, each made, readied and collected on its own.
create table if not exists public.quote_order_tickets (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  order_id     uuid not null references public.quote_orders(id) on delete cascade,
  station      text not null,
  -- e.g. "2 x Drinks: Desperados, 1 x Water", copied in when the ticket is made.
  items        text not null,
  status       text not null default 'making' check (status in ('making', 'ready', 'collected')),
  created_at   timestamptz not null default now(),
  ready_at     timestamptz,
  collected_at timestamptz,
  unique (order_id, station)
);

create index if not exists quote_order_tickets_screen_idx
  on public.quote_order_tickets (business_id, status, created_at);

alter table public.quote_walk_in_spots enable row level security;
alter table public.quote_order_tickets enable row level security;

-- What each plan includes:
--   walk_in   walk-in orders: QR receipts, pickup screens, table numbers, close/open orders.
--   stations  usage_limit = how many screens (Bar, Kitchen, ...) it can split orders between.
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
values
  ('free',       'walk_in',  false, null),
  ('free',       'stations', false, null),
  ('starter',    'walk_in',  true,  null),
  ('starter',    'stations', true,  1),
  ('pro',        'walk_in',  true,  null),
  ('pro',        'stations', true,  3),
  ('standard',   'walk_in',  true,  null),
  ('standard',   'stations', true,  3),
  ('growth',     'walk_in',  true,  null),
  ('growth',     'stations', true,  10),
  ('enterprise', 'walk_in',  true,  null),
  ('enterprise', 'stations', true,  null)
on conflict (plan_code, feature) do nothing;

update public.quote_plans set description = 'unlimited orders, voice notes, invoices, reminders, the staff inbox and walk-in orders with one pickup screen'
  where code = 'starter';
update public.quote_plans set description = 'delivery and riders, broadcasts, order board and sales dashboard, kitchen and bar screens (up to 3)'
  where code = 'pro';
update public.quote_plans set description = 'up to 3 branches, up to 10 screens for venues and events, more AI replies and broadcasts, set up for you'
  where code = 'growth';

-- Run this once in Supabase (SQL Editor > New query > paste > Run), after 0052. Running it again is safe.
--
-- Couriers through Shipbubble (docs/COURIERS.md). When a customer's address
-- isn't in any of a business's own delivery zones, the bot can offer a
-- Shipbubble courier at Shipbubble's price. yarnOga books it once the fee has
-- been collected.

-- The courier offered for a delivery and, once booked, Shipbubble's order id
-- and tracking page. Null for deliveries by the business's own riders.
alter table public.quote_deliveries add column if not exists courier jsonb;
-- Copied out of courier so Shipbubble's webhook can find the delivery quickly.
alter table public.quote_deliveries add column if not exists courier_order_id text;
create unique index if not exists quote_deliveries_courier_order_id_idx
  on public.quote_deliveries (courier_order_id) where courier_order_id is not null;

-- Each business switches couriers on in the app (Riders & delivery).
alter table public.quote_businesses add column if not exists courier_delivery boolean not null default false;

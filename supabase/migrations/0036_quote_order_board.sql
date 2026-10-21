-- The order board: where each confirmed order is, from new to delivered.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql). Nothing uses it until QUOTE_ORDER_BOARD=true.
--
-- New and Paid come from the order's status, and Out for delivery from its
-- delivery (migration 0030). The owner moves an order into production, or
-- marks it delivered (pickups, or deliveries made without the bot's riders).

alter table public.quote_orders
  add column if not exists stage text check (stage in ('in_production', 'delivered')),
  add column if not exists stage_at timestamptz;

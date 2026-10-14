-- Invoices and receipts for the quote and order bot.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0003_quote_orders.sql).
--
-- 1. Orders can now be marked 'paid' (the owner sends "paid KP-1001"), and we
--    remember when, for the date on the receipt.
-- 2. A private storage bucket for the business logo printed on invoices and
--    receipts (the owner sends it in the chat with the caption "logo").

alter table public.quote_orders drop constraint if exists quote_orders_status_check;
alter table public.quote_orders
  add constraint quote_orders_status_check
  check (status in ('quoted', 'confirmed', 'paid', 'cancelled'));

alter table public.quote_orders add column if not exists paid_at timestamptz;

insert into storage.buckets (id, name, public)
values ('quote-files', 'quote-files', false)
on conflict (id) do nothing;

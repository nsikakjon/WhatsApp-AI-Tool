-- Phase 1: quotes the bot sends and the orders customers confirm.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0002_quote_catalogue.sql).
--
-- Every quote is saved here first with status 'quoted'. When the customer
-- replies YES it becomes 'confirmed' (an order). Payment comes later.

create table if not exists public.quote_orders (
  id           uuid primary key default gen_random_uuid(),
  -- Short number customers and staff can quote back, e.g. KP-1042.
  order_number bigint generated always as identity (start with 1001) unique,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  status       text not null default 'quoted'
               check (status in ('quoted', 'confirmed', 'cancelled')),
  -- Sum of the line totals below, in kobo. Calculated in code from the price list.
  total_kobo   bigint not null check (total_kobo >= 0),
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at   timestamptz not null default now()
);

create table if not exists public.quote_order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.quote_orders(id) on delete cascade,
  variant_id       uuid not null references public.quote_variants(id),
  -- Copied at quote time so the order still reads correctly if the price list changes.
  name             text not null,
  quantity         integer not null check (quantity >= 1),
  unit_price_kobo  bigint not null check (unit_price_kobo >= 0),
  total_kobo       bigint not null check (total_kobo >= 0)
);

create index if not exists quote_orders_contact_status_idx
  on public.quote_orders (contact_id, status, created_at desc);
create index if not exists quote_order_items_order_id_idx
  on public.quote_order_items (order_id);

alter table public.quote_orders enable row level security;
alter table public.quote_order_items enable row level security;

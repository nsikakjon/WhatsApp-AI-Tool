-- Lets the quote and order bot serve any number of businesses.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0012_quote_receipts.sql).
--
-- Each business gets its own price list, its own WhatsApp number, its own
-- owner alert number and its own orders. The business that already uses the
-- bot on the main WhatsApp number (today KahnPrints) becomes business #1, and
-- everything already in the price list and orders tables is given to it, so
-- nothing changes for its customers.
--
-- Business #1 keeps its settings in Railway (QUOTE_BUSINESS_NAME,
-- QUOTE_OWNER_WA_ID, ...): its row below is only a placeholder for them.
-- Every other business keeps its settings in this table.

create table if not exists public.quote_businesses (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  -- What the business does, in a few words, e.g. 'a print shop' or 'a bakery'.
  -- The AI uses it to understand customers.
  description      text,
  -- Order numbers look like KP-1001; this is the "KP".
  order_prefix     text not null default 'ORD' check (order_prefix ~ '^[A-Z]{1,6}$'),
  -- The WhatsApp "Phone number ID" customers message. Empty for business #1,
  -- which answers on the main number (WHATSAPP_PHONE_NUMBER_ID).
  phone_number_id  text unique,
  -- WhatsApp number (digits only) that gets new-order alerts.
  owner_wa_id      text check (owner_wa_id is null or owner_wa_id ~ '^[0-9]{8,15}$'),
  -- Printed under the business name on invoices and receipts.
  business_details text,
  -- Bank details printed on invoices.
  payment_details  text,
  -- Set to false to stop answering for this business without deleting it.
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.quote_businesses enable row level security;

-- Business #1 (the main number). The fixed id lets the code and older rows point at it.
insert into public.quote_businesses (id, name, description, order_prefix)
values ('00000000-0000-0000-0000-000000000001', 'KahnPrints', 'a print shop', 'KP')
on conflict (id) do nothing;

-- Price list: each product belongs to one business. Existing products (and new
-- ones added without saying which business) belong to business #1.
alter table public.quote_products
  add column if not exists business_id uuid not null
  default '00000000-0000-0000-0000-000000000001'
  references public.quote_businesses(id) on delete cascade;

-- Two businesses can both sell "Flyers": the short name is unique per business.
alter table public.quote_products drop constraint if exists quote_products_slug_key;
alter table public.quote_products drop constraint if exists quote_products_business_slug_key;
alter table public.quote_products
  add constraint quote_products_business_slug_key unique (business_id, slug);

create index if not exists quote_products_business_id_idx on public.quote_products (business_id);

-- Orders: each one belongs to one business. Order numbers stay unique across
-- all businesses, so "paid KP-1042" can never touch another business's order.
alter table public.quote_orders
  add column if not exists business_id uuid not null
  default '00000000-0000-0000-0000-000000000001'
  references public.quote_businesses(id);

create index if not exists quote_orders_business_contact_status_idx
  on public.quote_orders (business_id, contact_id, status, created_at desc);

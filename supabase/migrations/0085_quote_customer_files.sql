-- Files customers send in the chat and the details they give for an order
-- (src/products/quote/customer-files.ts, QUOTE_CUSTOMER_FILES).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020). Running it again is safe and changes nothing.
--
-- Until this is run, keep QUOTE_CUSTOMER_FILES off: the bot only checks a
-- customer's picture as a payment screenshot, as before.

-- One row per file a customer sent: artwork, a logo, a style photo, a payment
-- screenshot. The file itself is in the private quote-files storage bucket
-- (path). The WhatsApp message id is unique, so a retried webhook never keeps
-- the same file twice. Files are deleted after 90 days.
create table if not exists public.quote_customer_files (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.quote_businesses(id) on delete cascade,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  order_id       uuid references public.quote_orders(id) on delete set null,
  wa_message_id  text not null unique,
  kind           text not null default 'order' check (kind in ('order', 'payment')),
  path           text not null,
  mime_type      text not null,
  file_name      text,
  caption        text,
  bytes          integer not null check (bytes >= 0),
  created_at     timestamptz not null default now()
);

create index if not exists quote_customer_files_contact on public.quote_customer_files (business_id, contact_id, created_at);
create index if not exists quote_customer_files_order on public.quote_customer_files (order_id);
create index if not exists quote_customer_files_created on public.quote_customer_files (created_at);

-- Only the server (service role) reads and writes it.
alter table public.quote_customer_files enable row level security;

-- What the customer told us for the order beyond items and quantities:
-- measurements, names to print, colours, a date.
alter table public.quote_orders add column if not exists notes text;
-- When the bot asked for a product's details before confirming, so it asks once.
alter table public.quote_orders add column if not exists details_asked_at timestamptz;

-- What the bot asks for before confirming an order of this product, e.g.
-- "Your artwork or logo" or "Measurements: chest, waist, length". Set in the
-- owner app's price list.
alter table public.quote_products add column if not exists ask_for text;

-- Phase 1: the KahnPrints price list, used by the quote and order bot.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
--
-- How it fits together:
--   quote_products     what you sell, e.g. "Business cards", "Flyers"
--   quote_variants     each version of it with its own price, e.g.
--                      "A5, 150gsm gloss, double-sided"
--   quote_price_tiers  the price per piece for that version, which can drop as
--                      the quantity goes up, e.g. 100+ at ₦150, 500+ at ₦100
--
-- All prices are in kobo (₦1 = 100 kobo), as whole numbers. The bot only ever
-- quotes prices read from these tables, never prices the AI comes up with.

create table if not exists public.quote_products (
  id          uuid primary key default gen_random_uuid(),
  -- Short fixed name used by the code, e.g. 'business-cards'.
  slug        text not null unique,
  -- Name shown to customers, e.g. 'Business cards'.
  name        text not null,
  description text,
  -- Set to false to stop quoting this product without deleting it.
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.quote_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.quote_products(id) on delete cascade,
  -- Shown to customers, e.g. 'A5, 150gsm gloss, double-sided'.
  name          text not null,
  -- Smallest quantity you'll accept an order for.
  min_quantity  integer not null default 1 check (min_quantity >= 1),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, name)
);

create table if not exists public.quote_price_tiers (
  id               uuid primary key default gen_random_uuid(),
  variant_id       uuid not null references public.quote_variants(id) on delete cascade,
  -- This price applies when the order is at least this many pieces.
  min_quantity     integer not null check (min_quantity >= 1),
  -- Price for ONE piece, in kobo.
  unit_price_kobo  bigint not null check (unit_price_kobo >= 0),
  created_at       timestamptz not null default now(),
  unique (variant_id, min_quantity)
);

create index if not exists quote_variants_product_id_idx on public.quote_variants (product_id);

-- Same lock-down as the Phase 0 tables: only the server can read or change these.
alter table public.quote_products enable row level security;
alter table public.quote_variants enable row level security;
alter table public.quote_price_tiers enable row level security;

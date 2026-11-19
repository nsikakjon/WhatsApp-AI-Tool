-- More on each business's shop page (docs/SHOP.md): a notice at the top,
-- sale prices, and "tell me when it's back" for sold-out options.
-- Run this once in Supabase: SQL Editor > New query > paste > Run (after
-- 0081). Running it again is safe. Until it's run, the shop works as before
-- and the owner app doesn't offer the notice or sale boxes.

-- shop_notice: one line the owner writes for the top of the shop, e.g.
-- "Free delivery in Lekki this week". Empty: no notice.
alter table public.quote_businesses add column if not exists shop_notice text;
alter table public.quote_businesses drop constraint if exists quote_businesses_shop_notice_length;
alter table public.quote_businesses add constraint quote_businesses_shop_notice_length
  check (char_length(shop_notice) <= 120);

-- A sale on a product: every price of every option is sale_percent lower,
-- on the shop page and in the bot's quotes, until sale_ends_at (the end of
-- that day in Lagos). Both empty: no sale.
alter table public.quote_products add column if not exists sale_percent smallint;
alter table public.quote_products drop constraint if exists quote_products_sale_percent_range;
alter table public.quote_products add constraint quote_products_sale_percent_range
  check (sale_percent is null or sale_percent between 1 and 90);
alter table public.quote_products add column if not exists sale_ends_at timestamptz;

-- Customers waiting for a sold-out option. The bot messages each once when
-- the option has stock again, then fills in sent_at. Waits older than 60
-- days are dropped without a message.
create table if not exists public.quote_stock_alerts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.quote_businesses(id) on delete cascade,
  variant_id     uuid not null references public.quote_variants(id) on delete cascade,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  wa_id          text not null,
  -- The business number the customer wrote to, so the message comes from it.
  from_number_id text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);

-- One open wait per customer per option: asking twice doesn't send twice.
create unique index if not exists quote_stock_alerts_open_idx
  on public.quote_stock_alerts (variant_id, contact_id) where sent_at is null;
create index if not exists quote_stock_alerts_pending_idx
  on public.quote_stock_alerts (created_at) where sent_at is null;

alter table public.quote_stock_alerts enable row level security;

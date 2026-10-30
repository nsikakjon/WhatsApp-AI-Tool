-- The shop page's own look and extra product photos (docs/SHOP.md).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0060). Running it again is safe. The shop page works without it,
-- in yarnOga's colours and with one photo per product.
--
-- shop_accent: the business's colour for buttons and highlights, e.g. "#e4572e".
-- shop_cover_path: where the cover photo is kept in the quote-files bucket.
-- more_photos: up to four more photos per product, swiped through when a
-- customer opens the product on the shop page.

alter table public.quote_businesses add column if not exists shop_accent text;
alter table public.quote_businesses drop constraint if exists quote_businesses_shop_accent_format;
alter table public.quote_businesses add constraint quote_businesses_shop_accent_format
  check (shop_accent is null or shop_accent ~ '^#[0-9a-f]{6}$');

alter table public.quote_businesses add column if not exists shop_cover_path text;

alter table public.quote_products add column if not exists more_photos text[] not null default '{}';
alter table public.quote_products drop constraint if exists quote_products_more_photos_max;
alter table public.quote_products add constraint quote_products_more_photos_max
  check (cardinality(more_photos) <= 4);

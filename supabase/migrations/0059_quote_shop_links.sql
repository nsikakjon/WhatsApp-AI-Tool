-- Each quote business's public shop page, <PUBLIC_URL>/shop/<name> (QUOTE_SHOP=true).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020 and 0049). Running it again is safe.
--
-- shop_slug is the <name> part, e.g. "mama-put-kitchen". It's made from the
-- business name the first time the owner sends "shop", and the owner can
-- change it. Empty = no shop page yet.

alter table public.quote_businesses add column if not exists shop_slug text;

alter table public.quote_businesses drop constraint if exists quote_businesses_shop_slug_format;
alter table public.quote_businesses add constraint quote_businesses_shop_slug_format
  check (shop_slug is null or shop_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');

create unique index if not exists quote_businesses_shop_slug_key on public.quote_businesses (shop_slug);

-- More on each business's shop page (docs/SHOP.md): where to find the shop
-- and its social media pages. Run this once in Supabase: SQL Editor > New
-- query > paste > Run (after 0061). Running it again is safe. The shop page
-- works without it, just without directions and social links.
--
-- shop_address: the address customers' map apps search for when they tap
-- Directions, e.g. "12 Allen Avenue, Ikeja, Lagos".
-- shop_socials: links to the business's pages, e.g.
-- {"instagram": "https://instagram.com/adasprints", "tiktok": "https://www.tiktok.com/@adasprints"}.

alter table public.quote_businesses add column if not exists shop_address text;
alter table public.quote_businesses drop constraint if exists quote_businesses_shop_address_length;
alter table public.quote_businesses add constraint quote_businesses_shop_address_length
  check (char_length(shop_address) <= 200);

alter table public.quote_businesses add column if not exists shop_socials jsonb not null default '{}';

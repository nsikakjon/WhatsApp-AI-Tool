-- The yarnOga quote bot demo: a made-up shop with a small sample price list,
-- so anyone can try the quote bot on the demo WhatsApp number.
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) after migration
-- 0020_quote_businesses.sql. It is safe to run again.
--
-- It starts switched off (active = false). To switch it on:
--   1. In Table editor > quote_businesses, open "yarnOga Demo Shop" and fill in
--      phone_number_id (the demo number's "Phone number ID" from Meta) and,
--      if you want order alerts, owner_wa_id. Set active to true.
--   2. On Railway, QUOTE_MULTI_BUSINESS must be true.
-- See docs/QUOTE_BUSINESSES.md.
--
-- Prices are in kobo: ₦5,000 = 500000.

insert into public.quote_businesses (id, name, description, order_prefix, active)
values (
  '00000000-0000-0000-0000-000000000002',
  'yarnOga Demo Shop',
  'a demo shop that sells branded gifts and party supplies',
  'DEMO',
  false
)
on conflict (id) do update set name = excluded.name, description = excluded.description, updated_at = now();

-- One row per price: product, option, minimum order, from this many pieces, price per piece (kobo).
with items (slug, product, option, min_quantity, from_quantity, unit_price_kobo) as (
  values
    ('t-shirts',     'Branded T-shirts',  'white, one-colour print',  10,  10,  500000),
    ('t-shirts',     'Branded T-shirts',  'white, one-colour print',  10,  50,  420000),
    ('t-shirts',     'Branded T-shirts',  'coloured, full-colour print', 10, 10, 650000),
    ('t-shirts',     'Branded T-shirts',  'coloured, full-colour print', 10, 50, 550000),
    ('mugs',         'Branded mugs',      'white ceramic, 11oz',      6,   6,   350000),
    ('mugs',         'Branded mugs',      'white ceramic, 11oz',      6,   36,  300000),
    ('water',        'Branded bottled water', 'pack of 12 (50cl)',    5,   5,   300000),
    ('cupcakes',     'Cupcakes',          'box of 6',                 2,   2,   600000),
    ('cupcakes',     'Cupcakes',          'box of 12',                1,   1,   1100000),
    ('souvenir-bags','Souvenir bags',     'small paper bag with logo', 20, 20,  80000),
    ('souvenir-bags','Souvenir bags',     'small paper bag with logo', 20, 100, 60000)
),
products as (
  insert into public.quote_products (business_id, slug, name)
  select distinct '00000000-0000-0000-0000-000000000002'::uuid, slug, product from items
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now()
  returning id, slug
),
variants as (
  insert into public.quote_variants (product_id, name, min_quantity)
  select distinct p.id, i.option, i.min_quantity from items i join products p on p.slug = i.slug
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now()
  returning id, product_id, name
)
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
select v.id, i.from_quantity, i.unit_price_kobo
from items i
join products p on p.slug = i.slug
join variants v on v.product_id = p.id and v.name = i.option
on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo;

-- A custom order the team prices by hand (no price row: the bot passes it to the owner).
insert into public.quote_products (business_id, slug, name)
values ('00000000-0000-0000-0000-000000000002', 'custom-cakes', 'Custom celebration cakes')
on conflict (business_id, slug) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
select id, 'any size, priced by the team', 1 from public.quote_products
where business_id = '00000000-0000-0000-0000-000000000002' and slug = 'custom-cakes'
on conflict (product_id, name) do update set active = true, updated_at = now();

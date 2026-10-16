-- KahnPrints price list, copied from the "PriceList" Google Sheet (Our Price
-- column) on 2026-10-10. Vendor names and vendor prices are left out on purpose.
-- Items at the end with no price are priced by the team depending on quantity:
-- the bot recognises them and passes the request to the owner.
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) after the
-- migrations up to 0020_quote_businesses.sql. It is safe to run again: it
-- updates existing rows instead of creating duplicates. Everything here
-- belongs to KahnPrints (business #1, id 00000000-0000-0000-0000-000000000001).
--
-- Prices are in kobo: ₦220 = 22000.

-- Flyers
insert into public.quote_products (slug, name) values ('flyers', 'Flyers')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A5, price per flyer', 10 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'flyers'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 22000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'flyers' and v.name = 'A5, price per flyer'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦220

-- Business cards
insert into public.quote_products (slug, name) values ('business-cards', 'Business cards')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'pack of 50, spot lamination, embossed logo, matte laminated, price per pack', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'business-cards'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 3000000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'business-cards' and v.name = 'pack of 50, spot lamination, embossed logo, matte laminated, price per pack'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦30,000

-- Brochures
insert into public.quote_products (slug, name) values ('brochures', 'Brochures')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A4, 108 pages, sample print with spot lamination, embossed logo and matte laminated cover', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'brochures'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 4500000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'brochures' and v.name = 'A4, 108 pages, sample print with spot lamination, embossed logo and matte laminated cover'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦45,000

-- Flex banners (billboards, backdrops)
insert into public.quote_products (slug, name) values ('flex-banners', 'Flex banners (billboards, backdrops)')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'price per square foot', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'flex-banners'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 50000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'flex-banners' and v.name = 'price per square foot'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦500

-- Billboard pocketing
insert into public.quote_products (slug, name) values ('billboard-pocketing', 'Billboard pocketing')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'price per piece', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'billboard-pocketing'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 800000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'billboard-pocketing' and v.name = 'price per piece'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦8,000

-- SAV window stickers
insert into public.quote_products (slug, name) values ('window-stickers', 'SAV window stickers')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'price per square foot', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'window-stickers'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 120000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'window-stickers' and v.name = 'price per square foot'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦1,200

-- Printed pouches
insert into public.quote_products (slug, name) values ('pouches', 'Printed pouches')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, '14 x 20cm (holds about 350g powder or 600g grains), pack of 100', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'pouches'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 7500000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'pouches' and v.name = '14 x 20cm (holds about 350g powder or 600g grains), pack of 100'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦75,000
insert into public.quote_variants (product_id, name, min_quantity)
  select id, '12 x 20cm (holds about 200g powder or 300g grains), pack of 100', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'pouches'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 6300000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'pouches' and v.name = '12 x 20cm (holds about 200g powder or 300g grains), pack of 100'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦63,000
insert into public.quote_variants (product_id, name, min_quantity)
  select id, '9 x 13cm resealable (50g), pack of 100', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'pouches'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 5500000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'pouches' and v.name = '9 x 13cm resealable (50g), pack of 100'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦55,000
insert into public.quote_variants (product_id, name, min_quantity)
  select id, '10 x 16cm resealable (100g), pack of 100', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'pouches'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 5700000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'pouches' and v.name = '10 x 16cm resealable (100g), pack of 100'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦57,000

-- Tote bags
insert into public.quote_products (slug, name) values ('tote-bags', 'Tote bags')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'price per bag', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'tote-bags'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 500000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'tote-bags' and v.name = 'price per bag'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦5,000

-- Photo frame party props
insert into public.quote_products (slug, name) values ('photo-frame-props', 'Photo frame party props')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, '3ft x 2ft cut-out', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'photo-frame-props'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 3200000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'photo-frame-props' and v.name = '3ft x 2ft cut-out'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦32,000

-- ID cards and lanyards
insert into public.quote_products (slug, name) values ('id-cards', 'ID cards and lanyards')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'ID card with transparent holder', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'id-cards'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 550000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'id-cards' and v.name = 'ID card with transparent holder'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦5,500
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'lanyard (rope)', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'id-cards'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 400000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'id-cards' and v.name = 'lanyard (rope)'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦4,000

-- Sublimation T-shirts
insert into public.quote_products (slug, name) values ('sublimation-tshirts', 'Sublimation T-shirts')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, '1 sample print (3 to 5 days)', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'sublimation-tshirts'
  on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, active = true, updated_at = now();
insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, 1700000 from public.quote_variants v join public.quote_products p on p.id = v.product_id
  where p.business_id = '00000000-0000-0000-0000-000000000001' and p.slug = 'sublimation-tshirts' and v.name = '1 sample print (3 to 5 days)'
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo; -- ₦17,000

-- Priced by the team depending on quantity (no price row).
insert into public.quote_products (slug, name) values ('dtf-transfers', 'DTF transfers (T-shirt printing)')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A1 size', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'dtf-transfers'
  on conflict (product_id, name) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A2 size', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'dtf-transfers'
  on conflict (product_id, name) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A3 size', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'dtf-transfers'
  on conflict (product_id, name) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A4 size', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'dtf-transfers'
  on conflict (product_id, name) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A5 size', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'dtf-transfers'
  on conflict (product_id, name) do update set active = true, updated_at = now();

insert into public.quote_products (slug, name) values ('sublimation-tshirts', 'Sublimation T-shirts')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'size XL', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'sublimation-tshirts'
  on conflict (product_id, name) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'size L', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'sublimation-tshirts'
  on conflict (product_id, name) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'size M', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'sublimation-tshirts'
  on conflict (product_id, name) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'bulk order (10 or more)', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'sublimation-tshirts'
  on conflict (product_id, name) do update set active = true, updated_at = now();

insert into public.quote_products (slug, name) values ('uv-stickers', 'UV stickers (mugs, water bottles)')
  on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A3 size', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'uv-stickers'
  on conflict (product_id, name) do update set active = true, updated_at = now();
insert into public.quote_variants (product_id, name, min_quantity)
  select id, 'A4 size', 1 from public.quote_products where business_id = '00000000-0000-0000-0000-000000000001' and slug = 'uv-stickers'
  on conflict (product_id, name) do update set active = true, updated_at = now();

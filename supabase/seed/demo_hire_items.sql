-- Hire items for the yarnOga Demo Shop, so anyone on the demo number can try
-- hire bookings: "Do you have a 20kVA generator for 3 days from Friday?"
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) after
-- migration 0097_quote_rentals.sql and demo_quote_business.sql. It is safe to
-- run again. The prices are made up for the demo.
--
-- The price list price is the daily rate. quote_rental_items says how many
-- the shop owns, a weekly rate and the refundable deposit for one. All money
-- is in kobo: ₦25,000 = 2500000.

update public.quote_businesses
set description = 'a demo shop that sells branded gifts and party supplies, and hires out generators, canopies, chairs, sound systems and concrete mixers by the day',
    updated_at = now()
where id = '00000000-0000-0000-0000-000000000002';

with items (slug, product, option, daily_kobo, units, weekly_kobo, deposit_kobo, description) as (
  values
    ('hire-generator', 'Generator',      '20kVA soundproof',      2500000, 2,   12000000, 5000000, 'Soundproof diesel generator for events, sites and offices. Fuel not included.'),
    ('hire-canopy',    'Canopy',         '20 x 20 ft, white',     1500000, 4,   null,     1000000, 'White event canopy, set up and taken down by our team.'),
    ('hire-chairs',    'Plastic chairs',      'white, armless',        20000,   300, null,     0,       'Clean white plastic chairs for parties, church events and meetings.'),
    ('hire-sound',     'Sound system',        '2 speakers, mixer, 2 mics', 3000000, 1, 15000000, 4000000, 'PA set for up to 300 guests, with a technician on request.'),
    ('hire-mixer',     'Concrete mixer', 'one-bag, diesel',       1800000, 2,   9000000,  4000000, 'One-bag diesel concrete mixer for building sites.')
),
products as (
  insert into public.quote_products (business_id, slug, name, description)
  select '00000000-0000-0000-0000-000000000002'::uuid, slug, product, description from items
  on conflict (business_id, slug) do update set name = excluded.name, description = excluded.description, active = true, updated_at = now()
  returning id, slug
),
variants as (
  insert into public.quote_variants (product_id, name, min_quantity)
  select p.id, i.option, 1 from items i join products p on p.slug = i.slug
  on conflict (product_id, name) do update set min_quantity = 1, active = true, updated_at = now()
  returning id, product_id, name
),
tiers as (
  insert into public.quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
  select v.id, 1, i.daily_kobo
  from items i join products p on p.slug = i.slug join variants v on v.product_id = p.id and v.name = i.option
  on conflict (variant_id, min_quantity) do update set unit_price_kobo = excluded.unit_price_kobo
  returning variant_id
)
insert into public.quote_rental_items (variant_id, business_id, units, weekly_rate_kobo, deposit_kobo)
select v.id, '00000000-0000-0000-0000-000000000002'::uuid, i.units, i.weekly_kobo, i.deposit_kobo
from items i join products p on p.slug = i.slug join variants v on v.product_id = p.id and v.name = i.option
on conflict (variant_id) do update
set units = excluded.units, weekly_rate_kobo = excluded.weekly_rate_kobo, deposit_kobo = excluded.deposit_kobo, updated_at = now();

-- Delivery zones for the yarnOga Demo Shop, so a visitor who types a Lagos
-- address or drops a pin sees a delivery fee straight away instead of waiting
-- for someone to price it.
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) after
-- demo_quote_business.sql and migration 0030_quote_delivery.sql. It is safe to
-- run again.
--
-- Fees are in kobo: ₦2,500 = 250000.

insert into public.quote_delivery_zones (id, business_id, name, areas, centre_lat, centre_lng, radius_m, fee_kobo)
values
  (
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'Lagos Mainland',
    '{ikeja,allen,opebi,alausa,maryland,ogba,agege,ojota,ketu,magodo,gbagada,yaba,surulere,ilupeju,oshodi,mushin,festac,isolo,ikotun,egbeda}',
    6.5550, 3.3500, 15000,
    250000
  ),
  (
    '00000000-0000-0000-0002-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'Lagos Island',
    '{lekki,ajah,ikoyi,victoria island,oniru,chevron,sangotedo,lagos island,obalende,vgc}',
    6.4450, 3.5000, 15000,
    400000
  )
on conflict (id) do update
  set name = excluded.name, areas = excluded.areas, centre_lat = excluded.centre_lat, centre_lng = excluded.centre_lng,
      radius_m = excluded.radius_m, fee_kobo = excluded.fee_kobo, active = true;

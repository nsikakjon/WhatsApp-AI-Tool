-- Delivery for the quote and order bot: delivery fees by zone, the business's
-- own riders, and one delivery record per order that a rider and the
-- customer follow through tracking links.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql). Nothing uses it until QUOTE_DELIVERY=true.

-- Delivery fees. A customer's pin is matched to the nearest zone whose circle
-- it falls in; a typed address is matched by the area names in it.
create table if not exists public.quote_delivery_zones (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default '00000000-0000-0000-0000-000000000001'
              references public.quote_businesses(id) on delete cascade,
  name        text not null,
  -- Lowercase area names, e.g. {ikeja,allen,opebi,alausa}.
  areas       text[] not null default '{}',
  centre_lat  double precision,
  centre_lng  double precision,
  radius_m    integer check (radius_m is null or radius_m > 0),
  fee_kobo    bigint not null check (fee_kobo >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check ((centre_lat is null) = (centre_lng is null) and (centre_lat is null) = (radius_m is null))
);

create index if not exists quote_delivery_zones_business_idx on public.quote_delivery_zones (business_id) where active;

-- Riders the business sends out itself.
create table if not exists public.quote_riders (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null default '00000000-0000-0000-0000-000000000001'
              references public.quote_businesses(id) on delete cascade,
  name        text not null,
  wa_id       text not null check (wa_id ~ '^[0-9]{8,15}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, wa_id)
);

-- One delivery per order. Names and numbers are copied in when the delivery
-- starts, so the tracking pages work without looking anything else up.
create table if not exists public.quote_deliveries (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null unique references public.quote_orders(id) on delete cascade,
  business_id     uuid not null default '00000000-0000-0000-0000-000000000001'
                  references public.quote_businesses(id) on delete cascade,
  order_ref       text not null,
  business_name   text not null,
  from_number_id  text,
  owner_wa_id     text,
  customer_wa_id  text not null,
  customer_name   text,
  -- asking: waiting for a pin or address. needs_fee: no zone matched, the
  -- owner sets the fee. proposed: fee shown, waiting for the customer's YES.
  -- pickup: the customer collects it. Then assigned > picked_up > delivered,
  -- or failed (the rider couldn't deliver) or cancelled.
  status          text not null default 'asking' check (status in
                  ('asking', 'needs_fee', 'proposed', 'pickup', 'assigned', 'picked_up', 'delivered', 'failed', 'cancelled')),
  address         text,
  lat             double precision,
  lng             double precision,
  zone_name       text,
  -- Already included in quote_orders.total_kobo once the customer has seen it.
  fee_kobo        bigint check (fee_kobo is null or fee_kobo >= 0),
  -- Who carries it. Only 'own_rider' today; a courier company would add its
  -- own name and reference here.
  courier         text not null default 'own_rider',
  rider_id        uuid references public.quote_riders(id) on delete set null,
  rider_name      text,
  rider_wa_id     text,
  -- The rider's latest position from the tracking page or a WhatsApp pin.
  -- Only the latest is kept.
  rider_lat       double precision,
  rider_lng       double precision,
  rider_seen_at   timestamptz,
  assigned_at     timestamptz,
  picked_up_at    timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists quote_deliveries_rider_idx
  on public.quote_deliveries (rider_wa_id) where status in ('assigned', 'picked_up');

alter table public.quote_delivery_zones enable row level security;
alter table public.quote_riders enable row level security;
alter table public.quote_deliveries enable row level security;

-- Example zones for business #1. Change the fees and areas, then run.
-- insert into public.quote_delivery_zones (name, areas, centre_lat, centre_lng, radius_m, fee_kobo) values
--   ('Ikeja',        '{ikeja,allen,opebi,alausa,oregun,ogba,agidingbi}', 6.6018, 3.3515, 4000, 200000),
--   ('Yaba',         '{yaba,akoka,sabo,ebute metta,surulere}',           6.5095, 3.3711, 4500, 300000),
--   ('Lekki Phase 1','{lekki phase 1,admiralty,oniru}',                  6.4478, 3.4723, 3000, 450000),
--   ('Victoria Island','{victoria island,vi,ikoyi}',                     6.4281, 3.4219, 4000, 400000);

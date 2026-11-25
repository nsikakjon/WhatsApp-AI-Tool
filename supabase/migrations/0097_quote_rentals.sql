-- Hire bookings for the quote bot (equipment, cars, event chairs and canopies, halls, costumes: anything hired by the day) (QUOTE_RENTALS, src/products/quote/rentals/).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020, 0025 and 0054). Running it again is safe and changes nothing.
--
-- A hire item is a price list row the owner marks with "hire 3 on". Its price
-- on the price list is the daily rate. This table adds how many of it the
-- business owns, an optional weekly rate and the refundable deposit, all
-- money in kobo.
--
-- Each booking holds one item for dates: it goes out on start_date and comes
-- back on return_date, so it is out for (return_date - start_date) days. A
-- quote doesn't hold anything; the customer's YES holds the dates for a day
-- while they pay, and payment books them.

create table if not exists public.quote_rental_items (
  variant_id        uuid primary key references public.quote_variants(id) on delete cascade,
  business_id       uuid not null references public.quote_businesses(id) on delete cascade,
  -- How many of this item the business has to hire out.
  units             integer not null default 1 check (units >= 1),
  -- Price for 7 days, in kobo. Null: every day is charged at the daily rate.
  weekly_rate_kobo  bigint check (weekly_rate_kobo >= 0),
  -- Refundable deposit for ONE unit, in kobo.
  deposit_kobo      bigint not null default 0 check (deposit_kobo >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists quote_rental_items_business_idx on public.quote_rental_items (business_id);

create table if not exists public.quote_rental_bookings (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.quote_businesses(id) on delete cascade,
  order_id             uuid not null references public.quote_orders(id) on delete cascade,
  variant_id           uuid not null references public.quote_variants(id),
  units                integer not null check (units >= 1),
  start_date           date not null,
  return_date          date not null check (return_date > start_date),
  -- The rates and deposit when quoted, so a later price change doesn't change this booking.
  daily_rate_kobo      bigint not null check (daily_rate_kobo >= 0),
  weekly_rate_kobo     bigint check (weekly_rate_kobo >= 0),
  deposit_kobo         bigint not null default 0 check (deposit_kobo >= 0),
  -- quoted: sent to the customer, holds nothing. held: the customer said YES, dates held until held_until.
  -- booked: paid. out: with the customer. returned: back and checked.
  status               text not null default 'quoted'
                       check (status in ('quoted', 'held', 'booked', 'out', 'returned', 'cancelled')),
  held_until           timestamptz,
  out_at               timestamptz,
  returned_at          timestamptz,
  -- From the returns check, in kobo: late days and damage taken off the deposit.
  late_kobo            bigint not null default 0 check (late_kobo >= 0),
  damage_kobo          bigint not null default 0 check (damage_kobo >= 0),
  return_notes         text,
  start_reminded_at    timestamptz,
  return_reminded_at   timestamptz,
  overdue_reminded_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (order_id, variant_id)
);

create index if not exists quote_rental_bookings_business_idx
  on public.quote_rental_bookings (business_id, status, start_date);
create index if not exists quote_rental_bookings_variant_idx
  on public.quote_rental_bookings (variant_id, start_date, return_date);

alter table public.quote_rental_items enable row level security;
alter table public.quote_rental_bookings enable row level security;

-- The owner's morning hire summary goes once a day.
alter table public.quote_businesses add column if not exists hire_summary_sent_on date;

-- The most units of an item already taken on any one day from p_start up to
-- (not including) p_return, leaving out order p_except. Something still out
-- after its return date counts as taken until it comes back.
create or replace function public.quote_rental_taken(p_variant_id uuid, p_start date, p_return date, p_except uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(max(day_units), 0)::integer from (
    select d.day, sum(o.units) as day_units
    from generate_series(p_start, p_return - 1, interval '1 day') as d(day)
    join public.quote_rental_bookings o
      on o.variant_id = p_variant_id
     and o.start_date <= d.day::date
     and (case when o.status = 'out'
               then greatest(o.return_date, (now() at time zone 'Africa/Lagos')::date + 1)
               else o.return_date end) > d.day::date
    join public.quote_orders q on q.id = o.order_id
    where o.order_id is distinct from p_except
      and q.status <> 'cancelled'
      and (o.status in ('booked', 'out') or (o.status = 'held' and o.held_until > now()))
    group by d.day
  ) taken;
$$;

-- Holds an order's hire items for p_hold_hours when the customer says YES.
-- Each item's row is locked first, so two customers saying YES to the last
-- generator at the same moment can't both get it. Returns {"ok": true}, or
-- {"ok": false, "variant_id": ..., "free": n} without holding anything.
create or replace function public.quote_rental_hold(p_order_id uuid, p_hold_hours integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  b record;
  owned integer;
  taken integer;
begin
  for b in
    select * from public.quote_rental_bookings
    where order_id = p_order_id and status in ('quoted', 'held')
    order by variant_id
  loop
    select units into owned from public.quote_rental_items where variant_id = b.variant_id for update;
    if owned is null then
      return jsonb_build_object('ok', false, 'variant_id', b.variant_id, 'free', 0);
    end if;
    taken := public.quote_rental_taken(b.variant_id, b.start_date, b.return_date, p_order_id);
    if taken + b.units > owned then
      return jsonb_build_object('ok', false, 'variant_id', b.variant_id, 'free', greatest(owned - taken, 0));
    end if;
  end loop;
  update public.quote_rental_bookings
     set status = 'held', held_until = now() + make_interval(hours => p_hold_hours), updated_at = now()
   where order_id = p_order_id and status in ('quoted', 'held');
  return jsonb_build_object('ok', true);
end;
$$;

-- Which plans include hire bookings (Pro and above, jay 25 Nov 2026).
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
values
  ('free',       'hire_bookings', false, null),
  ('starter',    'hire_bookings', false, null),
  ('pro',        'hire_bookings', true,  null),
  ('standard',   'hire_bookings', true,  null),
  ('growth',     'hire_bookings', true,  null),
  ('enterprise', 'hire_bookings', true,  null)
on conflict (plan_code, feature) do nothing;

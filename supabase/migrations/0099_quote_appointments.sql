-- Appointment booking for the quote bot: gyms, clinics, salons, tutors and
-- coaches (QUOTE_APPOINTMENTS, src/products/quote/appointments/).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020, 0025 and 0054). Running it again is safe and changes nothing.
--
-- A service is a price list row the owner marks with "book 3 60min" (a
-- one-to-one session) or "book 3 45min class 20" (a group class with 20
-- places). Its price stays on the price list. A calendar is a person who
-- sees customers (a doctor, a trainer), with weekly hours. Group classes run
-- at set times each week. Customers pick a service, a day and a time on
-- WhatsApp; nobody can book a time that's taken, because quote_appointment_place
-- locks the calendar (or the class) while it checks.

create table if not exists public.quote_booking_services (
  variant_id    uuid primary key references public.quote_variants(id) on delete cascade,
  business_id   uuid not null references public.quote_businesses(id) on delete cascade,
  minutes       integer not null check (minutes between 5 and 720),
  -- 1: one customer at a time with one calendar. More: a group class with this many places.
  places        integer not null default 1 check (places between 1 and 500),
  -- full: pay the price to book. deposit: pay deposit_kobo to book, the rest at the visit. later: book free, pay at the visit.
  payment       text not null default 'full' check (payment in ('full', 'deposit', 'later')),
  deposit_kobo  bigint not null default 0 check (deposit_kobo >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists quote_booking_services_business_idx on public.quote_booking_services (business_id);

-- A person (or room) customers book: "Dr Ada", "Coach Tunde".
create table if not exists public.quote_booking_calendars (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.quote_businesses(id) on delete cascade,
  name          text not null check (length(name) between 1 and 40),
  -- The services this person does (variant ids). Empty: all of them.
  services      uuid[] not null default '{}',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists quote_booking_calendars_business_idx on public.quote_booking_calendars (business_id, active);

-- Weekly hours, one range a day, in minutes after midnight Lagos time. Weekday 0 is Sunday.
create table if not exists public.quote_booking_hours (
  calendar_id   uuid not null references public.quote_booking_calendars(id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),
  start_minute  smallint not null check (start_minute between 0 and 1439),
  end_minute    smallint not null check (end_minute between 1 and 1440 and end_minute > start_minute),
  primary key (calendar_id, weekday)
);

-- When a group class runs each week, and who takes it (optional).
create table if not exists public.quote_booking_class_times (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.quote_businesses(id) on delete cascade,
  variant_id    uuid not null references public.quote_booking_services(variant_id) on delete cascade,
  calendar_id   uuid references public.quote_booking_calendars(id) on delete set null,
  weekday       smallint not null check (weekday between 0 and 6),
  start_minute  smallint not null check (start_minute between 0 and 1439),
  unique (variant_id, weekday, start_minute)
);

-- Times nobody can book: a public holiday, a doctor's afternoon off. No calendar: the whole business.
create table if not exists public.quote_booking_blocks (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.quote_businesses(id) on delete cascade,
  calendar_id   uuid references public.quote_booking_calendars(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null check (ends_at > starts_at),
  created_at    timestamptz not null default now()
);

create index if not exists quote_booking_blocks_business_idx on public.quote_booking_blocks (business_id, ends_at);

create table if not exists public.quote_appointments (
  id                uuid primary key default gen_random_uuid(),
  -- Shown as B1042 to customers and the owner.
  number            bigint generated always as identity unique,
  business_id       uuid not null references public.quote_businesses(id) on delete cascade,
  variant_id        uuid not null references public.quote_variants(id),
  calendar_id       uuid references public.quote_booking_calendars(id) on delete set null,
  contact_id        uuid,
  customer_wa_id    text not null,
  customer_name     text,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null check (ends_at > starts_at),
  places            integer not null default 1 check (places >= 1),
  -- held: waiting for payment until held_until. booked: confirmed. done / no_show: after the visit.
  status            text not null default 'booked'
                    check (status in ('held', 'booked', 'cancelled', 'done', 'no_show')),
  held_until        timestamptz,
  -- The pay link's order, when the customer pays to book.
  order_id          uuid references public.quote_orders(id) on delete set null,
  -- The price list price when booked, and what was paid to book (all of it, a deposit, or nothing).
  price_kobo        bigint not null default 0 check (price_kobo >= 0),
  pay_now_kobo      bigint not null default 0 check (pay_now_kobo >= 0),
  day_reminded_at   timestamptz,
  soon_reminded_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists quote_appointments_business_idx on public.quote_appointments (business_id, status, starts_at);
create index if not exists quote_appointments_calendar_idx on public.quote_appointments (calendar_id, starts_at);
create index if not exists quote_appointments_customer_idx on public.quote_appointments (business_id, customer_wa_id, starts_at);
create index if not exists quote_appointments_order_idx on public.quote_appointments (order_id);

alter table public.quote_booking_services enable row level security;
alter table public.quote_booking_calendars enable row level security;
alter table public.quote_booking_hours enable row level security;
alter table public.quote_booking_class_times enable row level security;
alter table public.quote_booking_blocks enable row level security;
alter table public.quote_appointments enable row level security;

-- The owner's booking rules, and the day the morning bookings summary last went.
alter table public.quote_businesses add column if not exists booking_notice_hours integer not null default 2;
alter table public.quote_businesses add column if not exists booking_days_ahead integer not null default 14;
alter table public.quote_businesses add column if not exists booking_cancel_hours integer not null default 12;
alter table public.quote_businesses add column if not exists booking_summary_sent_on date;

-- Books a time, or moves booking p_move to it. One-to-one: the calendar's row is
-- locked, and any booking on it that overlaps stops this one. Group class: the
-- class's row is locked, and the places already taken at that start can't
-- go over the class size. A held booking still waiting to be paid counts
-- until held_until. Returns the booking's id, or null when the time is taken.
create or replace function public.quote_appointment_place(
  p_business uuid, p_variant uuid, p_calendar uuid, p_start timestamptz, p_end timestamptz,
  p_wa_id text, p_name text, p_contact uuid, p_places integer, p_status text, p_hold_minutes integer,
  p_price_kobo bigint, p_pay_now_kobo bigint, p_move uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  size integer;
  taken integer;
  placed uuid;
begin
  select places into size from public.quote_booking_services
   where variant_id = p_variant and business_id = p_business for update;
  if size is null then return null; end if;

  if size > 1 then
    select coalesce(sum(a.places), 0) into taken from public.quote_appointments a
     where a.variant_id = p_variant and a.starts_at = p_start and a.id is distinct from p_move
       and (a.status = 'booked' or (a.status = 'held' and a.held_until > now()));
    if taken + p_places > size then return null; end if;
  else
    if p_calendar is null then return null; end if;
    perform 1 from public.quote_booking_calendars where id = p_calendar and business_id = p_business and active for update;
    if not found then return null; end if;
    perform 1 from public.quote_appointments a
     where a.calendar_id = p_calendar and a.id is distinct from p_move
       and a.starts_at < p_end and a.ends_at > p_start
       and (a.status = 'booked' or (a.status = 'held' and a.held_until > now()));
    if found then return null; end if;
  end if;

  if p_move is not null then
    update public.quote_appointments
       set starts_at = p_start, ends_at = p_end, calendar_id = p_calendar,
           day_reminded_at = null, soon_reminded_at = null, updated_at = now()
     where id = p_move and business_id = p_business and status in ('held', 'booked')
    returning id into placed;
    return placed;
  end if;

  insert into public.quote_appointments
    (business_id, variant_id, calendar_id, contact_id, customer_wa_id, customer_name, starts_at, ends_at,
     places, status, held_until, price_kobo, pay_now_kobo)
  values
    (p_business, p_variant, p_calendar, p_contact, p_wa_id, p_name, p_start, p_end,
     p_places, p_status, case when p_status = 'held' then now() + make_interval(mins => p_hold_minutes) end,
     p_price_kobo, p_pay_now_kobo)
  returning id into placed;
  return placed;
end;
$$;

-- Which plans include appointment booking (Pro and above, jay 25 Nov 2026).
insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
values
  ('free',       'appointments', false, null),
  ('starter',    'appointments', false, null),
  ('pro',        'appointments', true,  null),
  ('standard',   'appointments', true,  null),
  ('growth',     'appointments', true,  null),
  ('enterprise', 'appointments', true,  null)
on conflict (plan_code, feature) do nothing;

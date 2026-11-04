-- Numbers to connect (QUOTE_NUMBER_QUEUE, src/products/quote/numbers.ts).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020 and 0039). Running it again is safe and changes nothing.
--
-- A business that signs up by chat gets a new SIM for its bot and sends the
-- number in the chat. yarnOga staff add that number to our WhatsApp account
-- by hand, and the queue on /quote-setup/numbers shows who is doing which.

-- The people who connect numbers. They get a WhatsApp message when one is theirs.
create table if not exists public.quote_connect_staff (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  wa_id      text not null check (wa_id ~ '^[0-9]{8,15}$'),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per business waiting for, or done with, its own number.
create table if not exists public.quote_number_requests (
  business_id     uuid primary key references public.quote_businesses(id) on delete cascade,
  -- The new SIM's number, digits with country code. Null until the owner sends it.
  number          text check (number ~ '^[0-9]{8,15}$'),
  -- no_number: waiting for the owner; new: number in, nobody started;
  -- added: in WhatsApp Manager; registered: ready to send; live: answering customers.
  status          text not null default 'no_number'
                  check (status in ('no_number', 'new', 'added', 'registered', 'live')),
  assigned_to     uuid references public.quote_connect_staff(id) on delete set null,
  phone_number_id text,
  -- The two-step verification PIN set when registering. Meta asks for it if the number is ever moved.
  pin             text,
  -- Anything holding it up, e.g. "code not arriving, try voice call tomorrow".
  note            text,
  number_at       timestamptz,
  live_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One SIM, one business.
create unique index if not exists quote_number_requests_number_idx
  on public.quote_number_requests (number) where number is not null;

alter table public.quote_connect_staff enable row level security;
alter table public.quote_number_requests enable row level security;

-- Businesses that already signed up by chat and still have no number go on the queue.
insert into public.quote_number_requests (business_id)
select s.business_id
from public.quote_signups s
join public.quote_businesses b on b.id = s.business_id
where b.phone_number_id is null
on conflict (business_id) do nothing;

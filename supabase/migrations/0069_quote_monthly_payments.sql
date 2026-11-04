-- Monthly payments for a quote business's regular customers: gym members,
-- class fees, a monthly supply (QUOTE_MONTHLY_PAYMENTS,
-- src/products/quote/monthly.ts). Run this once in Supabase:
-- SQL Editor > New query > paste > Run (after 0020, 0032 and 0045).
-- Running it again is safe and changes nothing.
--
-- Money goes to the business's own bank through its Paystack subaccount, as
-- with pay links. All amounts are kobo (₦1 = 100 kobo).

-- What the business charges each month, e.g. "Gym membership" ₦15,000.
create table if not exists public.quote_monthly_plans (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  name         text not null check (length(name) between 1 and 60),
  price_kobo   bigint not null check (price_kobo >= 10000),
  -- false: no new members, and existing members keep paying.
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists quote_monthly_plans_business_idx on public.quote_monthly_plans (business_id);
alter table public.quote_monthly_plans enable row level security;

-- One row per customer on a plan. They pay on the same day each month
-- (pay_day; the 31st means the last day in shorter months). next_due only
-- moves on once that month is paid.
create table if not exists public.quote_monthly_members (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.quote_businesses(id) on delete cascade,
  plan_id       uuid not null references public.quote_monthly_plans(id),
  name          text not null check (length(name) between 1 and 80),
  wa_id         text not null check (wa_id ~ '^[0-9]{8,15}$'),
  pay_day       smallint not null check (pay_day between 1 and 31),
  next_due      date not null,
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  -- A card the customer paid with that Paystack lets us charge again
  -- (AUTH_...), the email it was saved under, and e.g. "Visa ••4081".
  card_code     text,
  card_email    text,
  card_label    text,
  last_paid_at  timestamptz,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz
);

create index if not exists quote_monthly_members_due_idx on public.quote_monthly_members (business_id, next_due) where status = 'active';
alter table public.quote_monthly_members enable row level security;

-- One row per member per month due. The unique (member, period) means a
-- month is only ever billed once, however often the timer runs.
create table if not exists public.quote_monthly_charges (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.quote_monthly_members(id) on delete cascade,
  period           date not null,
  -- The plan's price when the month came due.
  amount_kobo      bigint not null check (amount_kobo > 0),
  status           text not null default 'open' check (status in ('open', 'paid')),
  -- When the saved card was tried for this month (at most once).
  card_tried_at    timestamptz,
  -- The Paystack link sent for this month, and how many messages went with it (1 = the first, 2 and 3 = reminders).
  link_url         text,
  notices          smallint not null default 0,
  last_notice_at   timestamptz,
  -- The owner was told this month is overdue.
  owner_told_at    timestamptz,
  payment_ref      text,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  unique (member_id, period)
);

create index if not exists quote_monthly_charges_open_idx on public.quote_monthly_charges (member_id) where status = 'open';
alter table public.quote_monthly_charges enable row level security;

-- Marks a month paid and moves the member's next due date on, in one step.
-- True only for the call that flips it, so a webhook that arrives twice
-- can't count a month twice. A card Paystack can charge again is saved.
create or replace function public.quote_monthly_paid(
  p_charge     uuid,
  p_reference  text,
  p_next_due   date,
  p_card_code  text,
  p_card_email text,
  p_card_label text
) returns boolean
language plpgsql
as $$
declare
  c public.quote_monthly_charges;
begin
  update public.quote_monthly_charges
     set status = 'paid', payment_ref = p_reference, paid_at = now()
   where id = p_charge and status = 'open'
  returning * into c;
  if not found then
    return false;
  end if;
  update public.quote_monthly_members
     set next_due = greatest(next_due, p_next_due),
         last_paid_at = now(),
         card_code = coalesce(p_card_code, card_code),
         card_email = case when p_card_code is null then card_email else p_card_email end,
         card_label = case when p_card_code is null then card_label else p_card_label end
   where id = c.member_id;
  return true;
end;
$$;

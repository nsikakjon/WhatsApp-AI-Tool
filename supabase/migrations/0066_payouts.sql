-- Paying riders and staff from the owner app (QUOTE_PAYOUTS, src/owner/payouts.ts).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0030, 0032 and 0049). Running it again is safe and changes nothing.
--
-- Shop sales go straight to each shop's own bank (Paystack subaccounts), so
-- yarnOga's Paystack balance never holds a shop's money. To pay its people,
-- a shop first adds money to its payout balance by Paystack link; each
-- payment to a rider or staff member then comes off that balance, through
-- Paystack Transfers. All amounts are kobo (₦1 = 100 kobo).

-- Paystack's charge for each transfer, passed on to the shop. Change these
-- rows (never the code) if Paystack changes its fees. up_to_kobo null = above
-- the other rows.
create table if not exists public.payout_transfer_fees (
  up_to_kobo  bigint unique check (up_to_kobo is null or up_to_kobo > 0),
  fee_kobo    bigint not null check (fee_kobo >= 0)
);

alter table public.payout_transfer_fees enable row level security;

insert into public.payout_transfer_fees (up_to_kobo, fee_kobo)
select v.up_to, v.fee
  from (values (500000::bigint, 1000::bigint), (5000000, 2500), (null, 5000)) as v(up_to, fee)
 where not exists (select 1 from public.payout_transfer_fees);

-- The bank account each rider or staff member is paid into. Only the owner
-- can set or change it. recipient_code is Paystack's RCP_... for the account.
create table if not exists public.payout_recipients (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.quote_businesses(id) on delete cascade,
  rider_id        uuid references public.quote_riders(id) on delete cascade,
  app_user_id     uuid references public.app_users(id) on delete cascade,
  bank_code       text not null,
  bank_name       text not null,
  account_number  text not null check (account_number ~ '^[0-9]{10}$'),
  -- The bank's own name for the account, checked with Paystack.
  account_name    text not null,
  recipient_code  text not null,
  updated_at      timestamptz not null default now(),
  check ((rider_id is null) <> (app_user_id is null))
);

create unique index if not exists payout_recipients_rider_idx on public.payout_recipients (rider_id) where rider_id is not null;
create unique index if not exists payout_recipients_user_idx on public.payout_recipients (app_user_id) where app_user_id is not null;

alter table public.payout_recipients enable row level security;

-- One row per payment to a person. It starts as a 'draft' (the confirm
-- screen), becomes 'sending' once the money is taken off the balance, then
-- whatever Paystack says. The reference is sent to Paystack, which refuses a
-- second transfer with the same one.
create table if not exists public.payouts (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.quote_businesses(id) on delete cascade,
  reference       text not null unique,
  recipient_id    uuid not null references public.payout_recipients(id),
  -- Copied from the recipient when the draft is made, so history stays true if the account changes.
  payee_name      text not null,
  payee_wa_id     text,
  account_label   text not null,
  recipient_code  text not null,
  amount_kobo     bigint not null check (amount_kobo > 0),
  fee_kobo        bigint not null check (fee_kobo >= 0),
  reason          text not null,
  -- Set for a rider's delivery pay, so one delivery can't be paid twice.
  delivery_id     uuid references public.quote_deliveries(id) on delete set null,
  status          text not null default 'draft'
                  check (status in ('draft', 'sending', 'pending', 'otp', 'success', 'failed', 'reversed')),
  transfer_code   text,
  failure         text,
  created_by      uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  done_at         timestamptz
);

create index if not exists payouts_business_idx on public.payouts (business_id, created_at desc);
create unique index if not exists payouts_delivery_once_idx on public.payouts (delivery_id)
  where delivery_id is not null and status in ('sending', 'pending', 'otp', 'success');

alter table public.payouts enable row level security;

-- Money in and out of each shop's payout balance. The balance is the sum.
-- A top-up is keyed by its Paystack payment, a payout and its refund by the
-- payout, so a retried webhook can never count anything twice.
create table if not exists public.payout_ledger (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.quote_businesses(id) on delete cascade,
  kind               text not null check (kind in ('topup', 'payout', 'refund')),
  -- Positive in, negative out.
  amount_kobo        bigint not null check (amount_kobo <> 0),
  payment_reference  text unique references public.payments(reference),
  payout_id          uuid references public.payouts(id),
  created_at         timestamptz not null default now(),
  unique (payout_id, kind),
  check ((kind = 'topup') = (payment_reference is not null)),
  check ((kind = 'topup') = (payout_id is null))
);

create index if not exists payout_ledger_business_idx on public.payout_ledger (business_id, created_at desc);

alter table public.payout_ledger enable row level security;

-- Takes a confirmed draft's amount and fee off the balance and marks it
-- 'sending'. One business at a time, so two taps can't both spend the same
-- money. Returns 'ok', 'low' (not enough balance), 'expired' (the confirm
-- screen is over 10 minutes old), 'gone' (not a draft any more) or 'paid'
-- (that delivery has been paid already).
create or replace function public.payout_start(p_id uuid, p_business_id uuid)
returns text
language plpgsql
as $$
declare
  v_payout public.payouts%rowtype;
  v_balance bigint;
begin
  perform pg_advisory_xact_lock(hashtext('payout:' || p_business_id::text));
  select * into v_payout from public.payouts where id = p_id and business_id = p_business_id for update;
  if not found or v_payout.status <> 'draft' then
    return 'gone';
  end if;
  if v_payout.created_at < now() - interval '10 minutes' then
    return 'expired';
  end if;
  select coalesce(sum(amount_kobo), 0) into v_balance from public.payout_ledger where business_id = p_business_id;
  if v_balance < v_payout.amount_kobo + v_payout.fee_kobo then
    return 'low';
  end if;
  begin
    update public.payouts set status = 'sending', sent_at = now() where id = p_id;
  exception when unique_violation then
    return 'paid';
  end;
  insert into public.payout_ledger (business_id, kind, amount_kobo, payout_id)
  values (p_business_id, 'payout', -(v_payout.amount_kobo + v_payout.fee_kobo), p_id);
  return 'ok';
end;
$$;

-- Records what Paystack says about a payout. A failed or reversed one puts
-- the money back on the balance, once. Returns true when the status changed.
create or replace function public.payout_finish(p_id uuid, p_status text, p_transfer_code text, p_failure text)
returns boolean
language plpgsql
as $$
declare
  v_payout public.payouts%rowtype;
begin
  select * into v_payout from public.payouts where id = p_id for update;
  if not found or v_payout.status = p_status then
    return false;
  end if;
  if not (
    (p_status in ('pending', 'otp', 'success', 'failed') and v_payout.status in ('sending', 'pending', 'otp'))
    or (p_status = 'reversed' and v_payout.status in ('sending', 'pending', 'otp', 'success'))
  ) then
    return false;
  end if;
  update public.payouts
     set status = p_status,
         transfer_code = coalesce(p_transfer_code, transfer_code),
         failure = p_failure,
         done_at = case when p_status in ('success', 'failed', 'reversed') then now() else null end
   where id = p_id;
  if p_status in ('failed', 'reversed') then
    insert into public.payout_ledger (business_id, kind, amount_kobo, payout_id)
    values (v_payout.business_id, 'refund', v_payout.amount_kobo + v_payout.fee_kobo, p_id)
    on conflict (payout_id, kind) do nothing;
  end if;
  return true;
end;
$$;

revoke all on function public.payout_start(uuid, uuid) from public, anon, authenticated;
grant execute on function public.payout_start(uuid, uuid) to service_role;
revoke all on function public.payout_finish(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.payout_finish(uuid, text, text, text) to service_role;

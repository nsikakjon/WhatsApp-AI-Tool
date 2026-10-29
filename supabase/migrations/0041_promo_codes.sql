-- Promo codes (DAYONES) and quote bot referral codes.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql and 0032_payments.sql).
--
-- A code takes a percentage off the first month of a Paystack payment. People
-- type it at the end of their upgrade message, e.g. "upgrade standard DAYONES".
--
-- To switch a code off, set active to false on its row (Table Editor >
-- promo_codes). To let more people use it, raise max_uses. Leave max_uses
-- empty for no limit. The owner can also do both from WhatsApp.

create table if not exists public.promo_codes (
  code                 text primary key check (code ~ '^[A-Z0-9]{4,20}$'),
  -- New referral codes get 10% unless this is changed on their row.
  percent_off          integer not null default 10 check (percent_off between 1 and 99),
  -- How many different people can use it. Empty = no limit.
  max_uses             integer check (max_uses is null or max_uses >= 0),
  active               boolean not null default true,
  -- 'flyer' or 'quote' to allow it on one product only. Empty = every product.
  product              text,
  -- Set on a quote business's referral code: the business that shared it.
  referrer_business_id uuid unique references public.quote_businesses (id) on delete cascade,
  created_at           timestamptz not null default now()
);

alter table public.promo_codes enable row level security;

insert into public.promo_codes (code, percent_off, max_uses)
values ('DAYONES', 50, 10)
on conflict (code) do nothing;

alter table public.payments
  add column if not exists promo_code text references public.promo_codes (code);

create index if not exists payments_promo_code_idx on public.payments (promo_code) where promo_code is not null;

-- Saves a pending payment with the code's discount, or says why the code
-- can't be used. The code's row is locked while it checks, so two people
-- can't take the last place at the same moment. A place is held for a day
-- by an unpaid link, and for good once paid. Each person can use a code once.
create or replace function public.create_promo_payment(
  p_reference   text,
  p_product     text,
  p_wa_id       text,
  p_purpose     jsonb,
  p_amount_kobo bigint,
  p_months      integer,
  p_code        text
) returns table (result text, code text, percent_off integer, amount_off_kobo bigint, max_uses integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  promo public.promo_codes%rowtype;
  taken integer;
  off   bigint;
begin
  select * into promo from public.promo_codes c where c.code = upper(trim(p_code)) for update;

  if not found or not promo.active or (promo.product is not null and promo.product <> p_product) then
    return query select 'unknown', upper(trim(p_code)), null::integer, null::bigint, null::integer;
    return;
  end if;

  if promo.referrer_business_id is not null and promo.referrer_business_id::text = p_purpose ->> 'businessId' then
    return query select 'own', promo.code, promo.percent_off, null::bigint, promo.max_uses;
    return;
  end if;

  if exists (select 1 from public.payments p where p.promo_code = promo.code and p.wa_id = p_wa_id and p.status = 'paid') then
    return query select 'used', promo.code, promo.percent_off, null::bigint, promo.max_uses;
    return;
  end if;

  if promo.max_uses is not null then
    select count(distinct p.wa_id) into taken
    from public.payments p
    where p.promo_code = promo.code
      and p.wa_id <> p_wa_id
      and (p.status = 'paid' or p.created_at > now() - interval '1 day');
    if taken >= promo.max_uses then
      return query select 'full', promo.code, promo.percent_off, null::bigint, promo.max_uses;
      return;
    end if;
  end if;

  off := (p_amount_kobo / greatest(p_months, 1)) * promo.percent_off / 100;
  insert into public.payments (reference, product, wa_id, purpose, amount_kobo, promo_code)
  values (p_reference, p_product, p_wa_id, p_purpose, p_amount_kobo - off, promo.code);

  return query select 'applied', promo.code, promo.percent_off, off, promo.max_uses;
end;
$$;

revoke all on function public.create_promo_payment(text, text, text, jsonb, bigint, integer, text) from public, anon, authenticated;
grant execute on function public.create_promo_payment(text, text, text, jsonb, bigint, integer, text) to service_role;

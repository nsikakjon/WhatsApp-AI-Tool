-- Partner packages on the dashboard (/dashboard/partners): the discount code,
-- the yarnOga shop, the day-before reminder and the event report that go with
-- an agreed partnership.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0041_promo_codes.sql and 0088_partner_leads.sql). Running it again is safe.

-- The last day a promo code works (Lagos time). Empty = no end date.
alter table public.promo_codes
  add column if not exists ends_on date;

-- The partner's discount code and its shop on yarnOga, when the event starts,
-- and the reminder its ticket holders get the day before.
alter table public.partner_leads
  add column if not exists promo_code text references public.promo_codes (code) on update cascade on delete set null,
  add column if not exists business_id uuid references public.quote_businesses (id) on delete set null,
  add column if not exists event_time time,
  add column if not exists reminder_on boolean not null default false,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists reminder_sent_count integer;

-- A shop yarnOga takes no fee from on its pay-link payments, whatever its plan
-- (e.g. a partner's event tickets).
alter table public.quote_businesses
  add column if not exists no_fee boolean not null default false;

-- Same as in 0041, plus: a code past its end date is refused like an unknown one.
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

  if not found or not promo.active or (promo.product is not null and promo.product <> p_product)
     or (promo.ends_on is not null and promo.ends_on < (now() at time zone 'Africa/Lagos')::date) then
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

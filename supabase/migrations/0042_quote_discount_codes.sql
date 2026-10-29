-- Discount codes a business gives its own customers: a Christmas or Black
-- Friday sale, or a code for an influencer to share.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql).
--
-- The owner makes a code by sending "new code XMAS 20%" to their bot. A
-- customer with a quote sends XMAS and the quote's items get 20% off. Owners
-- see how many orders each code brought in by sending "codes".

create table if not exists public.quote_discount_codes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.quote_businesses (id) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9]{4,20}$'),
  percent_off integer not null check (percent_off between 1 and 90),
  -- How many orders can use it. Empty = no limit.
  max_uses    integer check (max_uses is null or max_uses >= 0),
  -- The code stops working after this moment. Empty = no end date.
  ends_at     timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, code)
);

alter table public.quote_discount_codes enable row level security;

alter table public.quote_orders
  add column if not exists discount_code text,
  -- Taken off the items (not delivery), in kobo. total_kobo is already net of it.
  add column if not exists discount_kobo bigint not null default 0 check (discount_kobo >= 0);

create index if not exists quote_orders_discount_code_idx
  on public.quote_orders (business_id, discount_code) where discount_code is not null;

-- Puts a code on a customer's open quote. The code's row is locked while it
-- checks, so its last place can't go to two quotes at once. A quote holds a
-- place for a day; a confirmed or paid order keeps it.
create or replace function public.quote_apply_discount(p_business_id uuid, p_order_id uuid, p_code text)
returns table (result text, code text, percent_off integer, discount_kobo bigint, total_kobo bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  dc        public.quote_discount_codes%rowtype;
  ord       public.quote_orders%rowtype;
  taken     integer;
  items     bigint;
  new_off   bigint;
begin
  select * into dc from public.quote_discount_codes c
  where c.business_id = p_business_id and c.code = upper(trim(p_code)) and c.active
  for update;
  if not found then
    return query select 'unknown', upper(trim(p_code)), null::integer, null::bigint, null::bigint;
    return;
  end if;
  if dc.ends_at is not null and dc.ends_at <= now() then
    return query select 'ended', dc.code, dc.percent_off, null::bigint, null::bigint;
    return;
  end if;

  select * into ord from public.quote_orders o
  where o.id = p_order_id and o.business_id = p_business_id and o.status = 'quoted'
  for update;
  if not found then
    return query select 'no_quote', dc.code, dc.percent_off, null::bigint, null::bigint;
    return;
  end if;

  if dc.max_uses is not null then
    select count(*) into taken from public.quote_orders o
    where o.business_id = p_business_id
      and o.discount_code = dc.code
      and o.id <> ord.id
      and (o.status in ('confirmed', 'paid') or (o.status = 'quoted' and o.updated_at > now() - interval '1 day'));
    if taken >= dc.max_uses then
      return query select 'full', dc.code, dc.percent_off, null::bigint, null::bigint;
      return;
    end if;
  end if;

  select coalesce(sum(i.total_kobo), 0) into items from public.quote_order_items i where i.order_id = ord.id;
  new_off := items * dc.percent_off / 100;

  update public.quote_orders o
  set discount_code = dc.code,
      discount_kobo = new_off,
      total_kobo = o.total_kobo + o.discount_kobo - new_off,
      updated_at = now()
  where o.id = ord.id;

  return query select 'applied', dc.code, dc.percent_off, new_off, ord.total_kobo + ord.discount_kobo - new_off;
end;
$$;

revoke all on function public.quote_apply_discount(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.quote_apply_discount(uuid, uuid, text) to service_role;

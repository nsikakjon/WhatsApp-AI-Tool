-- Counter sales and cost prices for the owner app (QUOTE_COUNTER_SALES=true).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0037 and 0049). Running it again is safe.
--
-- 1. Each price list row can have a cost price: what one piece costs the
--    business to buy or make, in kobo. Empty = not entered yet.
-- 2. Each order line keeps the cost price it had when it was quoted, like it
--    keeps its price, so last month's profit doesn't change when costs do.
-- 3. Counter sales: staff ring up what a walk-in shopper bought in the app.
--    Prices are worked out in code from the price list; this records the sale
--    and takes it off the stock in one step.

alter table public.quote_variants
  add column if not exists cost_kobo bigint check (cost_kobo is null or cost_kobo >= 0);

alter table public.quote_order_items
  add column if not exists unit_cost_kobo bigint check (unit_cost_kobo is null or unit_cost_kobo >= 0);

create or replace function public.quote_order_item_cost()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.unit_cost_kobo is null then
    select v.cost_kobo into new.unit_cost_kobo from quote_variants v where v.id = new.variant_id;
  end if;
  return new;
end;
$$;

drop trigger if exists quote_order_items_cost on public.quote_order_items;
create trigger quote_order_items_cost
  before insert on public.quote_order_items
  for each row execute function public.quote_order_item_cost();

create table if not exists public.quote_counter_sales (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.quote_businesses(id) on delete cascade,
  -- Made by the sale screen, so pressing Confirm twice records one sale.
  sale_key    uuid not null,
  sold_by     uuid references public.app_users(id) on delete set null,
  paid_by     text not null check (paid_by in ('cash', 'transfer', 'pos')),
  total_kobo  bigint not null check (total_kobo >= 0),
  created_at  timestamptz not null default now(),
  -- A sale rung up by mistake is cancelled, not deleted; its stock goes back.
  voided_at   timestamptz,
  voided_by   uuid references public.app_users(id) on delete set null,
  unique (business_id, sale_key)
);

create table if not exists public.quote_counter_sale_items (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.quote_counter_sales(id) on delete cascade,
  variant_id      uuid not null references public.quote_variants(id),
  name            text not null,
  quantity        integer not null check (quantity >= 1),
  unit_price_kobo bigint not null check (unit_price_kobo >= 0),
  unit_cost_kobo  bigint check (unit_cost_kobo is null or unit_cost_kobo >= 0),
  total_kobo      bigint not null check (total_kobo >= 0)
);

create index if not exists quote_counter_sales_business_idx
  on public.quote_counter_sales (business_id, created_at desc);
create index if not exists quote_counter_sale_items_sale_idx
  on public.quote_counter_sale_items (sale_id);

alter table public.quote_counter_sales enable row level security;
alter table public.quote_counter_sale_items enable row level security;

-- Records a sale. p_lines is a list of {variant_id, name, quantity,
-- unit_price_kobo, total_kobo}. Answers one row:
--   ok        the sale was recorded (sale_id)
--   duplicate this sale_key was already recorded (sale_id of that sale)
--   short     not enough left of `item` (left_in_stock); nothing recorded
--   unknown   an item isn't on this business's price list; nothing recorded
create or replace function public.quote_counter_sale(
  p_business_id uuid,
  p_sale_key uuid,
  p_sold_by uuid,
  p_paid_by text,
  p_lines jsonb
)
returns table (result text, sale_id uuid, item text, left_in_stock integer)
language plpgsql
set search_path = public
as $$
declare
  found_id uuid;
  wanted   integer;
  matched  integer;
  short    record;
begin
  select s.id into found_id from quote_counter_sales s where s.business_id = p_business_id and s.sale_key = p_sale_key;
  if found_id is not null then
    return query select 'duplicate'::text, found_id, null::text, null::integer;
    return;
  end if;

  select count(*) into wanted from jsonb_array_elements(p_lines);
  -- Locks the stock rows, in a fixed order, so two tills selling the last
  -- few of something wait for each other instead of both selling them.
  select count(*) into matched from (
    select v.id from quote_variants v
    join quote_products p on p.id = v.product_id
    where p.business_id = p_business_id
      and v.id in (select (l->>'variant_id')::uuid from jsonb_array_elements(p_lines) l)
    order by v.id
    for update of v
  ) locked;
  if wanted = 0 or matched <> wanted then
    return query select 'unknown'::text, null::uuid, null::text, null::integer;
    return;
  end if;

  select l->>'name' as name, v.stock into short
  from jsonb_array_elements(p_lines) l
  join quote_variants v on v.id = (l->>'variant_id')::uuid
  where v.stock is not null and v.stock < (l->>'quantity')::integer
  limit 1;
  if found then
    return query select 'short'::text, null::uuid, short.name, short.stock;
    return;
  end if;

  insert into quote_counter_sales (business_id, sale_key, sold_by, paid_by, total_kobo)
  values (
    p_business_id, p_sale_key, p_sold_by, p_paid_by,
    (select sum((l->>'total_kobo')::bigint) from jsonb_array_elements(p_lines) l)
  )
  returning id into found_id;

  insert into quote_counter_sale_items (sale_id, variant_id, name, quantity, unit_price_kobo, unit_cost_kobo, total_kobo)
  select found_id, v.id, l->>'name', (l->>'quantity')::integer, (l->>'unit_price_kobo')::bigint, v.cost_kobo, (l->>'total_kobo')::bigint
  from jsonb_array_elements(p_lines) l
  join quote_variants v on v.id = (l->>'variant_id')::uuid;

  update quote_variants v
  set stock = v.stock - (l->>'quantity')::integer, updated_at = now()
  from jsonb_array_elements(p_lines) l
  where v.id = (l->>'variant_id')::uuid and v.stock is not null;

  return query select 'ok'::text, found_id, null::text, null::integer;
exception
  -- The same sale sent twice at the same moment: the second finds the first.
  when unique_violation then
    select s.id into found_id from quote_counter_sales s where s.business_id = p_business_id and s.sale_key = p_sale_key;
    return query select 'duplicate'::text, found_id, null::text, null::integer;
end;
$$;

-- Cancels a sale and puts its items back on the stock. False when it's
-- already cancelled or isn't this business's.
create or replace function public.quote_counter_void(p_business_id uuid, p_sale_id uuid, p_voided_by uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  done uuid;
begin
  update quote_counter_sales
  set voided_at = now(), voided_by = p_voided_by
  where id = p_sale_id and business_id = p_business_id and voided_at is null
  returning id into done;
  if done is null then
    return false;
  end if;
  update quote_variants v
  set stock = v.stock + t.quantity, updated_at = now()
  from (
    select variant_id, sum(quantity)::integer as quantity
    from quote_counter_sale_items where sale_id = done group by variant_id
  ) t
  where v.id = t.variant_id and v.stock is not null;
  return true;
end;
$$;

revoke execute on function public.quote_counter_sale(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.quote_counter_sale(uuid, uuid, uuid, text, jsonb) to service_role;
revoke execute on function public.quote_counter_void(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.quote_counter_void(uuid, uuid, uuid) to service_role;

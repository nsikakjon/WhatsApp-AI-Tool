-- The offline till (OWNER_APP_OFFLINE=true): counter sales rung up while the
-- shop's internet is down, sent when it comes back.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0060). Running it again is safe.
--
-- A sale made offline has already happened: the customer paid and left with
-- the goods. So when it arrives it is always recorded, never refused:
--   * created_at is when the till sold it, so it lands on the right day in
--     the sales, profit and tax figures; synced_at is when it arrived.
--   * If another till sold the last few while both were offline, the stock
--     goes to 0 (not below) and short_by says how many more were sold than
--     the stock showed, so the owner can count the shelf.
--   * If the price list changed while the till was offline, the line keeps
--     the price the customer was charged, and list_price_kobo the price the
--     list had when the sale arrived.

alter table public.quote_counter_sales
  add column if not exists synced_at timestamptz;

alter table public.quote_counter_sale_items
  add column if not exists short_by integer check (short_by is null or short_by >= 1),
  add column if not exists list_price_kobo bigint check (list_price_kobo is null or list_price_kobo >= 0);

-- Records a sale from the offline till. p_lines is a list of {variant_id,
-- name, quantity, unit_price_kobo, total_kobo, list_price_kobo}. Answers one row:
--   ok        recorded (sale_id)
--   duplicate this sale_key was already recorded (sale_id of that sale)
--   unknown   an item isn't on this business's price list (even as removed);
--             nothing recorded
create or replace function public.quote_counter_sale_offline(
  p_business_id uuid,
  p_sale_key uuid,
  p_sold_by uuid,
  p_paid_by text,
  p_sold_at timestamptz,
  p_lines jsonb
)
returns table (result text, sale_id uuid)
language plpgsql
set search_path = public
as $$
declare
  found_id uuid;
  wanted   integer;
  matched  integer;
begin
  select s.id into found_id from quote_counter_sales s where s.business_id = p_business_id and s.sale_key = p_sale_key;
  if found_id is not null then
    return query select 'duplicate'::text, found_id;
    return;
  end if;

  select count(distinct l->>'variant_id') into wanted from jsonb_array_elements(p_lines) l;
  -- Removed items count: the till may have sold one before it was removed.
  select count(*) into matched from (
    select v.id from quote_variants v
    join quote_products p on p.id = v.product_id
    where p.business_id = p_business_id
      and v.id in (select (l->>'variant_id')::uuid from jsonb_array_elements(p_lines) l)
    order by v.id
    for update of v
  ) locked;
  if wanted = 0 or matched <> wanted then
    return query select 'unknown'::text, null::uuid;
    return;
  end if;

  insert into quote_counter_sales (business_id, sale_key, sold_by, paid_by, total_kobo, created_at, synced_at)
  values (
    p_business_id, p_sale_key, p_sold_by, p_paid_by,
    (select sum((l->>'total_kobo')::bigint) from jsonb_array_elements(p_lines) l),
    p_sold_at, now()
  )
  returning id into found_id;

  insert into quote_counter_sale_items (sale_id, variant_id, name, quantity, unit_price_kobo, unit_cost_kobo, total_kobo, short_by, list_price_kobo)
  select found_id, v.id, l->>'name', (l->>'quantity')::integer, (l->>'unit_price_kobo')::bigint, v.cost_kobo, (l->>'total_kobo')::bigint,
    case when v.stock is not null and v.stock < (l->>'quantity')::integer then (l->>'quantity')::integer - v.stock end,
    (l->>'list_price_kobo')::bigint
  from jsonb_array_elements(p_lines) l
  join quote_variants v on v.id = (l->>'variant_id')::uuid;

  update quote_variants v
  set stock = greatest(v.stock - (l->>'quantity')::integer, 0), updated_at = now()
  from jsonb_array_elements(p_lines) l
  where v.id = (l->>'variant_id')::uuid and v.stock is not null;

  return query select 'ok'::text, found_id;
exception
  when unique_violation then
    select s.id into found_id from quote_counter_sales s where s.business_id = p_business_id and s.sale_key = p_sale_key;
    return query select 'duplicate'::text, found_id;
end;
$$;

-- Same as in 0060, except that cancelling a sale puts back only what it
-- took off the stock (not the pieces it was short by).
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
    select variant_id, sum(quantity - coalesce(short_by, 0))::integer as quantity
    from quote_counter_sale_items where sale_id = done group by variant_id
  ) t
  where v.id = t.variant_id and v.stock is not null;
  return true;
end;
$$;

revoke execute on function public.quote_counter_sale_offline(uuid, uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.quote_counter_sale_offline(uuid, uuid, uuid, text, timestamptz, jsonb) to service_role;

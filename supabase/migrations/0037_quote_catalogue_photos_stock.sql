-- Product photos and stock levels for the quote bot (Pro and above).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql). Nothing uses it until QUOTE_CATALOGUE=true.
--
-- Stock is counted per price list row. Empty = not counted (made to order,
-- as for a print shop). When it is counted, the bot won't quote more than is
-- left, and each confirmed order takes its quantity off.
-- Photos are kept in the quote-files storage bucket; photo_path says where.
-- Saving a new price list on the setup screen keeps both.

alter table public.quote_variants
  add column if not exists stock integer check (stock is null or stock >= 0);

alter table public.quote_products
  add column if not exists photo_path text;

-- Takes a confirmed order's quantities off the stock, in one step, so two
-- orders confirmed together are both counted. Stock never goes below 0.
create or replace function public.quote_take_stock(p_order_id uuid)
returns void
language sql
set search_path = public
as $$
  update quote_variants v
  set stock = greatest(v.stock - t.quantity, 0), updated_at = now()
  from (
    select variant_id, sum(quantity)::integer as quantity
    from quote_order_items where order_id = p_order_id group by variant_id
  ) t
  where v.id = t.variant_id and v.stock is not null;
$$;

revoke execute on function public.quote_take_stock(uuid) from public, anon, authenticated;
grant execute on function public.quote_take_stock(uuid) to service_role;

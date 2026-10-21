-- Price lists kept in sync with a Google Sheet, and extra columns as details.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0023_quote_price_list_import.sql and 0039_quote_chat_signup.sql).
--
-- An owner's other columns (colours, delivery time, ...) are saved with each
-- item as details, for the bot to answer questions with. A business can keep
-- the link to the Google Sheet its price list came from: the server checks it
-- once a day, and changes wait in pending_price_csv until the owner says to
-- use them (only when QUOTE_PRICE_SHEETS=true).

alter table public.quote_variants
  add column if not exists details text check (char_length(details) <= 300);

alter table public.quote_businesses
  add column if not exists price_sheet_url text,
  add column if not exists pending_price_csv text,
  add column if not exists sheet_checked_at timestamptz;

alter table public.quote_signups
  add column if not exists sheet_url text;

-- Same as in 0023, now also saving each item's details.
create or replace function public.quote_replace_price_list(p_business_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
  tier jsonb;
  v_product uuid;
  v_variant uuid;
  kept_products uuid[] := '{}';
  kept_variants uuid[] := '{}';
begin
  if not exists (select 1 from quote_businesses where id = p_business_id) then
    raise exception 'unknown business %', p_business_id;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'the new price list is empty';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into quote_products (business_id, slug, name)
    values (p_business_id, item->>'slug', item->>'product')
    on conflict (business_id, slug) do update set name = excluded.name, active = true, updated_at = now()
    returning id into v_product;
    kept_products := kept_products || v_product;

    insert into quote_variants (product_id, name, min_quantity, details)
    values (v_product, item->>'option', (item->>'minQuantity')::integer, nullif(item->>'details', ''))
    on conflict (product_id, name) do update set min_quantity = excluded.min_quantity, details = excluded.details, active = true, updated_at = now()
    returning id into v_variant;
    kept_variants := kept_variants || v_variant;

    delete from quote_price_tiers where variant_id = v_variant;
    for tier in select * from jsonb_array_elements(coalesce(item->'tiers', '[]'::jsonb)) loop
      insert into quote_price_tiers (variant_id, min_quantity, unit_price_kobo)
      values (v_variant, (tier->>'minQuantity')::integer, (tier->>'unitPriceKobo')::bigint);
    end loop;
  end loop;

  update quote_variants v set active = false, updated_at = now()
  from quote_products p
  where p.id = v.product_id and p.business_id = p_business_id and v.active and not (v.id = any(kept_variants));

  update quote_products set active = false, updated_at = now()
  where business_id = p_business_id and active and not (id = any(kept_products));
end;
$$;

-- Only the server may call it, never the public API keys.
revoke execute on function public.quote_replace_price_list(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.quote_replace_price_list(uuid, jsonb) to service_role;

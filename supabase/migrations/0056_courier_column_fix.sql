-- Run this once in Supabase (SQL Editor > New query > paste > Run), after 0053. Running it again is safe.
--
-- 0030 had already made quote_deliveries.courier a text column set to
-- 'own_rider', so 0053's "add column if not exists courier jsonb" left it as
-- text. The bot then read 'own_rider' as a courier and every delivery showed
-- "Delivery by undefined". This turns it into the jsonb column 0053 meant:
-- empty for deliveries by the business's own riders.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'quote_deliveries'
      and column_name = 'courier' and data_type = 'text'
  ) then
    alter table public.quote_deliveries alter column courier drop default;
    alter table public.quote_deliveries alter column courier drop not null;
    alter table public.quote_deliveries alter column courier type jsonb
      using case when courier like '{%' then courier::jsonb end;
  end if;
end $$;

-- 0053's other changes, in case it hasn't been run.
alter table public.quote_deliveries add column if not exists courier jsonb;
alter table public.quote_deliveries add column if not exists courier_order_id text;
create unique index if not exists quote_deliveries_courier_order_id_idx
  on public.quote_deliveries (courier_order_id) where courier_order_id is not null;
alter table public.quote_businesses add column if not exists courier_delivery boolean not null default false;

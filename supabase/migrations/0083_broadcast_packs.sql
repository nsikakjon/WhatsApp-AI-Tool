-- Broadcast message packs (src/products/quote/broadcast-packs.ts): a shop buys
-- messages by Paystack link to send its flyers and offers to the customers
-- who opted in.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0029). Running it again is safe and changes nothing.
--
-- Until this is run, broadcasts work as before: only the monthly messages in
-- broadcast_addons.

-- The packs on sale. Prices in kobo (₦1 = 100 kobo): change or add rows here,
-- never in code. billed_by says who Meta charges for the shop's messages:
--   'yarnoga'   the shop is on a number in yarnOga's account, so the price
--               covers Meta's charge (about ₦70 to ₦80 a message) and our margin
--   'business'  the shop connected its own account and pays Meta itself, so
--               the price is only our service fee
-- Pack messages don't run out at the end of the month.
create table if not exists public.quote_broadcast_packs (
  code        text primary key,
  name        text not null,
  messages    integer not null check (messages > 0),
  price_kobo  bigint not null check (price_kobo > 0),
  billed_by   text not null check (billed_by in ('yarnoga', 'business')),
  active      boolean not null default true,
  sort_order  integer not null default 0
);

alter table public.quote_broadcast_packs enable row level security;

insert into public.quote_broadcast_packs (code, name, messages, price_kobo, billed_by, sort_order)
values
  ('messages-100', '100 messages', 100, 1500000, 'yarnoga', 1),
  ('messages-250', '250 messages', 250, 3500000, 'yarnoga', 2),
  ('messages-500', '500 messages', 500, 6500000, 'yarnoga', 3),
  ('own-messages-100', '100 messages', 100, 250000, 'business', 1),
  ('own-messages-250', '250 messages', 250, 625000, 'business', 2),
  ('own-messages-500', '500 messages', 500, 1250000, 'business', 3)
on conflict (code) do nothing;

-- One row per pack paid for. The Paystack reference is the key, so a retried
-- webhook can never add the same pack twice.
create table if not exists public.quote_broadcast_topups (
  reference    text primary key references public.payments(reference),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  pack_code    text not null,
  messages     integer not null check (messages > 0),
  amount_kobo  bigint not null check (amount_kobo > 0),
  created_at   timestamptz not null default now()
);

alter table public.quote_broadcast_topups enable row level security;

-- Pack messages a business still has.
create table if not exists public.broadcast_pack_balance (
  business_id  uuid primary key references public.quote_businesses(id) on delete cascade,
  messages     integer not null check (messages >= 0),
  updated_at   timestamptz not null default now()
);

alter table public.broadcast_pack_balance enable row level security;

-- Saves a paid pack and adds its messages; false when the reference was already saved.
create or replace function public.broadcast_add_pack(
  p_reference text, p_business_id uuid, p_pack_code text, p_messages integer, p_amount_kobo bigint
)
returns boolean
language plpgsql
as $$
begin
  insert into public.quote_broadcast_topups (reference, business_id, pack_code, messages, amount_kobo)
  values (p_reference, p_business_id, p_pack_code, p_messages, p_amount_kobo)
  on conflict (reference) do nothing;
  if not found then
    return false;
  end if;

  insert into public.broadcast_pack_balance (business_id, messages)
  values (p_business_id, p_messages)
  on conflict (business_id) do update
    set messages = public.broadcast_pack_balance.messages + excluded.messages, updated_at = now();
  return true;
end;
$$;

revoke all on function public.broadcast_add_pack(text, uuid, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.broadcast_add_pack(text, uuid, text, integer, bigint) to service_role;

-- Confirming a broadcast, as in 0029, now with pack messages: the month's
-- messages (p_monthly_limit, 0 for a shop with packs only) are used first,
-- then the pack's.
create or replace function public.broadcast_queue(p_broadcast_id bigint, p_monthly_limit integer)
returns table (outcome text, recipients integer)
language plpgsql
as $$
declare
  b public.broadcasts%rowtype;
  month_room integer;
  pack integer;
  added integer;
begin
  select * into b from public.broadcasts where id = p_broadcast_id for update;
  if not found or b.status <> 'draft' then
    return query select 'not_draft'::text, coalesce(b.recipient_count, 0);
    return;
  end if;

  -- Only one broadcast per business is confirmed at a time, so two confirmed
  -- together can't both use the same room.
  perform pg_advisory_xact_lock(hashtext(b.business_id::text));
  month_room := greatest(p_monthly_limit - public.broadcast_used_this_month(b.business_id), 0);
  select coalesce(max(p.messages), 0) into pack from public.broadcast_pack_balance p where p.business_id = b.business_id;
  if month_room + pack = 0 then
    return query select 'limit_reached'::text, 0;
    return;
  end if;

  insert into public.broadcast_recipients (broadcast_id, contact_id, wa_id)
  select b.id, o.contact_id, c.wa_id
  from public.broadcast_optins o
  join public.contacts c on c.id = o.contact_id
  where o.business_id = b.business_id and o.status = 'in'
  order by o.opted_in_at, o.contact_id
  limit month_room + pack
  on conflict do nothing;
  get diagnostics added = row_count;

  if added > month_room then
    update public.broadcast_pack_balance
       set messages = messages - (added - month_room), updated_at = now()
     where business_id = b.business_id;
  end if;

  update public.broadcasts
  set status = case when added = 0 then 'done' else 'queued' end,
      recipient_count = added,
      queued_at = now(),
      finished_at = case when added = 0 then now() else null end
  where id = b.id;

  return query select 'queued'::text, added;
end;
$$;

-- Broadcasts: a quote bot business sends a promo or price update to the
-- customers who asked to receive them (opted in).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql).
--
-- Nothing sends until BROADCASTS_ENABLED is true on Railway AND the business
-- has a row in broadcast_addons (the paid add-on). See docs/BROADCASTS.md.

-- Who said yes (or no) to offers, per customer per business. A customer can
-- join one business's offers and not another's.
create table if not exists public.broadcast_optins (
  business_id    uuid not null references public.quote_businesses(id) on delete cascade,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  -- 'in' = sends offers, 'out' = said stop.
  status         text not null check (status in ('in', 'out')),
  opted_in_at    timestamptz,
  opted_out_at   timestamptz,
  -- How they said it, e.g. 'keyword' (typed JOIN) or 'button' (tapped Stop).
  source         text not null default 'keyword',
  -- The WhatsApp message they said it in, as proof of consent.
  wa_message_id  text,
  updated_at     timestamptz not null default now(),
  primary key (business_id, contact_id)
);

create index if not exists broadcast_optins_in_idx
  on public.broadcast_optins (business_id, opted_in_at) where status = 'in';

-- The paid add-on: a business can broadcast only with a row here, and only up
-- to monthly_limit messages per calendar month (Lagos time).
create table if not exists public.broadcast_addons (
  business_id    uuid primary key references public.quote_businesses(id) on delete cascade,
  monthly_limit  integer not null check (monthly_limit >= 0),
  active         boolean not null default true,
  updated_at     timestamptz not null default now()
);

-- One broadcast: written by the owner, previewed, then confirmed.
create table if not exists public.broadcasts (
  id               bigserial primary key,
  business_id      uuid not null references public.quote_businesses(id) on delete cascade,
  -- Copied at creation so the sender doesn't need to look the business up.
  business_name    text not null,
  -- Our number it goes out from (Meta "Phone number ID").
  from_number_id   text,
  -- Who wrote it (digits only); told when it finishes.
  owner_wa_id      text not null,
  body             text not null check (length(body) between 1 and 900),
  -- The owner's picture (a WhatsApp media id), for templates with a picture header.
  image_media_id   text,
  -- draft -> queued -> done, or cancelled.
  status           text not null default 'draft'
                   check (status in ('draft', 'queued', 'done', 'cancelled')),
  recipient_count  integer not null default 0,
  created_at       timestamptz not null default now(),
  queued_at        timestamptz,
  finished_at      timestamptz
);

create index if not exists broadcasts_business_idx on public.broadcasts (business_id, created_at desc);
create index if not exists broadcasts_queued_idx on public.broadcasts (status) where status = 'queued';

-- Each person a broadcast goes to. One row per person, so nobody can get the
-- same broadcast twice.
create table if not exists public.broadcast_recipients (
  broadcast_id   bigint not null references public.broadcasts(id) on delete cascade,
  contact_id     uuid not null references public.contacts(id) on delete cascade,
  wa_id          text not null,
  -- pending -> sending -> sent / failed, or skipped (opted out before it went).
  -- A row left on 'sending' after a crash is never retried, so a person is
  -- never sent the same broadcast twice.
  status         text not null default 'pending'
                 check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  wa_message_id  text,
  error          text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  primary key (broadcast_id, contact_id)
);

create index if not exists broadcast_recipients_pending_idx
  on public.broadcast_recipients (created_at) where status = 'pending';

-- Server-only, like the other tables.
alter table public.broadcast_optins enable row level security;
alter table public.broadcast_addons enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;

-- Messages a business has used (or has queued) this month, Lagos time.
create or replace function public.broadcast_used_this_month(p_business_id uuid)
returns integer
language sql stable
as $$
  select count(*)::integer
  from public.broadcast_recipients r
  join public.broadcasts b on b.id = r.broadcast_id
  where b.business_id = p_business_id
    and r.status in ('pending', 'sending', 'sent')
    and r.created_at >= (date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos');
$$;

-- Confirms a draft: picks the opted-in customers (oldest opt-in first, up to
-- what's left of this month's limit), adds them as recipients and queues it.
-- All in one step, so two "send" messages at once can't queue it twice.
-- Returns the outcome ('queued', 'not_draft', 'limit_reached') and how many
-- people it will go to.
create or replace function public.broadcast_queue(p_broadcast_id bigint, p_monthly_limit integer)
returns table (outcome text, recipients integer)
language plpgsql
as $$
declare
  b public.broadcasts%rowtype;
  room integer;
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
  room := greatest(p_monthly_limit - public.broadcast_used_this_month(b.business_id), 0);
  if room = 0 then
    return query select 'limit_reached'::text, 0;
    return;
  end if;

  insert into public.broadcast_recipients (broadcast_id, contact_id, wa_id)
  select b.id, o.contact_id, c.wa_id
  from public.broadcast_optins o
  join public.contacts c on c.id = o.contact_id
  where o.business_id = b.business_id and o.status = 'in'
  order by o.opted_in_at, o.contact_id
  limit room
  on conflict do nothing;
  get diagnostics added = row_count;

  update public.broadcasts
  set status = case when added = 0 then 'done' else 'queued' end,
      recipient_count = added,
      queued_at = now(),
      finished_at = case when added = 0 then now() else null end
  where id = b.id;

  return query select 'queued'::text, added;
end;
$$;

-- Only the server (service role) may run these.
revoke all on function public.broadcast_used_this_month(uuid) from public, anon, authenticated;
revoke all on function public.broadcast_queue(bigint, integer) from public, anon, authenticated;
grant execute on function public.broadcast_used_this_month(uuid) to service_role;
grant execute on function public.broadcast_queue(bigint, integer) to service_role;

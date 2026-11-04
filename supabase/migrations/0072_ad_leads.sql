-- Leads from WhatsApp ads (AD_LEADS=true).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0043_whatsapp_sent_counts.sql). Running it again is safe.
--
-- When someone taps a Click-to-WhatsApp ad (or a Facebook post's WhatsApp
-- button), Meta tells us which ad it was on their first message. Each of
-- those first messages is saved here, on whichever of our numbers it reached,
-- so the dashboard and the owner app can show how many people each ad brought.
--
-- Meta's free entry point window: if the business replies within 24 hours,
-- everything it sends that person for the next 72 hours is free, templates
-- included. The database opens the window itself when the first reply is
-- saved, and the sent-message counts put messages inside a window under
-- free_sent instead of sent, so they don't count towards Meta's fees on the
-- dashboard or a plan's bot message allowance.

create table if not exists public.ad_leads (
  id                 uuid primary key default gen_random_uuid(),
  -- The number's "Phone number ID" the person messaged. Empty = the main number.
  business_number_id text not null default '',
  contact_id         uuid not null references public.contacts(id) on delete cascade,
  -- The message that carried the ad. Unique, so a webhook Meta sends twice is saved once.
  wa_message_id      text not null unique,
  -- "ad" or "post", and the ad's (or post's) ID in Meta Ads Manager.
  source_type        text not null default 'ad',
  source_id          text not null,
  source_url         text,
  headline           text,
  body               text,
  media_type         text,
  -- Meta's click ID, for matching the chat to the ad click in Ads Manager.
  ctwa_clid          text,
  first_message_at   timestamptz not null default now(),
  -- Set when the first reply goes out within 24 hours: the free window runs until free_until.
  replied_at         timestamptz,
  free_until         timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists ad_leads_number_created_idx on public.ad_leads (business_number_id, created_at desc);
create index if not exists ad_leads_contact_idx on public.ad_leads (contact_id, business_number_id);

alter table public.ad_leads enable row level security;

alter table public.whatsapp_sent_counts
  add column if not exists free_sent integer not null default 0 check (free_sent >= 0);

create or replace function public.count_whatsapp_sent()
returns trigger
language plpgsql
as $$
declare
  number_id text := coalesce(new.business_number_id, '');
  free boolean;
begin
  -- The first reply to an ad lead within 24 hours opens the 72-hour free window.
  update public.ad_leads
     set replied_at = new.created_at,
         free_until = new.created_at + interval '72 hours'
   where contact_id = new.contact_id
     and business_number_id = number_id
     and free_until is null
     and new.created_at < first_message_at + interval '24 hours';

  free := exists (
    select 1 from public.ad_leads
     where contact_id = new.contact_id
       and business_number_id = number_id
       and new.created_at < free_until
  );

  insert into public.whatsapp_sent_counts as c (business_number_id, month, sent, free_sent)
  values (
    number_id,
    date_trunc('month', new.created_at at time zone 'Africa/Lagos')::date,
    case when free then 0 else 1 end,
    case when free then 1 else 0 end
  )
  on conflict (business_number_id, month)
  do update set sent = c.sent + excluded.sent,
                free_sent = c.free_sent + excluded.free_sent,
                updated_at = now();
  return new;
end;
$$;

revoke all on function public.count_whatsapp_sent() from public, anon, authenticated;

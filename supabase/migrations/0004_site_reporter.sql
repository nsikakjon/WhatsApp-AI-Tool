-- Phase 2: construction site progress reporter.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0001_contacts_and_messages.sql).
--
-- Sites, the people who report on them, every update they send, and the
-- daily reports the bot has sent.

create table if not exists public.site_sites (
  id          uuid primary key default gen_random_uuid(),
  -- Short name staff and managers will recognise, e.g. "Lekki Duplex Block B".
  name        text not null,
  address     text,
  -- Turn a site off (finished, paused) without deleting its history.
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.site_members (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.site_sites(id) on delete cascade,
  -- Their WhatsApp number in international format, digits only, e.g. 2348012345678.
  -- One site per person for now: whatever they send is logged against this site.
  wa_id       text not null unique,
  name        text not null,
  -- 'staff' send updates. 'manager' also send updates, and get the daily report.
  role        text not null default 'staff' check (role in ('staff', 'manager')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.site_updates (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.site_sites(id) on delete cascade,
  member_id      uuid not null references public.site_members(id) on delete cascade,
  -- WhatsApp's id for the message. Unique, so a re-sent webhook is never logged twice.
  wa_message_id  text not null unique,
  kind           text not null check (kind in ('text', 'photo', 'voice')),
  -- What they typed, the photo caption, or what was said in the voice note.
  body           text,
  -- Where the photo is saved in Supabase Storage (bucket "site-photos").
  photo_path     text,
  created_at     timestamptz not null default now()
);

create index if not exists site_updates_site_created_idx
  on public.site_updates (site_id, created_at);

create table if not exists public.site_reports (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.site_sites(id) on delete cascade,
  -- The day the report covers (Lagos time).
  report_date  date not null,
  body         text,
  created_at   timestamptz not null default now(),
  -- One daily report per site per day, so a restart never sends it twice.
  unique (site_id, report_date)
);

alter table public.site_sites enable row level security;
alter table public.site_members enable row level security;
alter table public.site_updates enable row level security;
alter table public.site_reports enable row level security;

-- Private storage bucket for site photos (not visible to the public).
insert into storage.buckets (id, name, public)
values ('site-photos', 'site-photos', false)
on conflict (id) do nothing;

-- Phase 3: birthday and event flyers for WhatsApp groups (alumni, friends).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0001_contacts_and_messages.sql).
--
-- Groups, the admins who run them, the members whose birthdays get a flyer,
-- and a record of each birthday flyer sent so none is ever sent twice.

create table if not exists public.flyer_groups (
  id          uuid primary key default gen_random_uuid(),
  -- The name printed on flyers, e.g. "Unilag Class of 2010".
  name        text not null,
  -- Where the group's logo is saved in Supabase Storage (bucket "flyer-photos").
  logo_path   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.flyer_admins (
  group_id      uuid not null references public.flyer_groups(id) on delete cascade,
  -- Their WhatsApp number in international format, digits only, e.g. 2348012345678.
  wa_id         text not null,
  -- An admin of several groups works on the one they used last.
  last_used_at  timestamptz not null default now(),
  primary key (group_id, wa_id)
);

create index if not exists flyer_admins_wa_id on public.flyer_admins (wa_id);

create table if not exists public.flyer_members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.flyer_groups(id) on delete cascade,
  name         text not null,
  birth_month  smallint not null check (birth_month between 1 and 12),
  birth_day    smallint not null check (birth_day between 1 and 31),
  -- Where their photo is saved in Supabase Storage (bucket "flyer-photos").
  photo_path   text not null,
  created_at   timestamptz not null default now()
);

-- One entry per name in a group, so re-adding someone updates them instead.
create unique index if not exists flyer_members_group_name
  on public.flyer_members (group_id, lower(name));
create index if not exists flyer_members_birthday
  on public.flyer_members (birth_month, birth_day);

create table if not exists public.flyer_birthday_sends (
  member_id  uuid not null references public.flyer_members(id) on delete cascade,
  year       smallint not null,
  sent_at    timestamptz not null default now(),
  -- One birthday flyer per member per year, however often the timer runs.
  primary key (member_id, year)
);

alter table public.flyer_groups enable row level security;
alter table public.flyer_admins enable row level security;
alter table public.flyer_members enable row level security;
alter table public.flyer_birthday_sends enable row level security;

-- Private storage for member photos and logos.
insert into storage.buckets (id, name, public)
values ('flyer-photos', 'flyer-photos', false)
on conflict (id) do nothing;

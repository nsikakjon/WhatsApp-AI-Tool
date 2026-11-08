-- Oko, the farm and land app (/farm/): fields saved in the database so they
-- sync across phones, invite links for testers, farms shared with helpers,
-- and Jay's admin view. See docs/FARM.md.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Running it again is safe.

-- Everyone who uses Oko. Jay is the admin (he logs in with FARM_PASSWORD).
create table if not exists public.farm_users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  role        text not null default 'tester' check (role in ('admin', 'tester')),
  disabled    boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);
-- Only one admin.
create unique index if not exists farm_users_one_admin on public.farm_users (role) where role = 'admin';

-- Logins. Only a hash of each token is kept, so a database leak can't log anyone in.
create table if not exists public.farm_sessions (
  token_hash  text primary key,
  user_id     uuid not null references public.farm_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists farm_sessions_user_idx on public.farm_sessions (user_id);

-- Invite links: 'app' brings a new tester in (made by Jay); 'field' adds a
-- helper to one farm (made by the farm's owner).
create table if not exists public.farm_invites (
  token_hash  text primary key,
  kind        text not null check (kind in ('app', 'field')),
  field_id    text,
  name_hint   text,
  created_by  uuid not null references public.farm_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references public.farm_users(id) on delete set null
);

-- Each field: the app's whole field record (crop, boundary, scouting,
-- records, tasks) as JSON. Photos are kept in storage, not in here.
create table if not exists public.farm_fields (
  id          text primary key,
  owner_id    uuid not null references public.farm_users(id) on delete cascade,
  data        jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.farm_users(id) on delete set null,
  deleted_at  timestamptz
);
create index if not exists farm_fields_updated_idx on public.farm_fields (updated_at);

-- Who can open each field besides its owner.
create table if not exists public.farm_members (
  field_id    text not null references public.farm_fields(id) on delete cascade,
  user_id     uuid not null references public.farm_users(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (field_id, user_id)
);
create index if not exists farm_members_user_idx on public.farm_members (user_id);

-- Photos taken in the app (scouting, beacons, site features).
create table if not exists public.farm_photos (
  id          uuid primary key default gen_random_uuid(),
  field_id    text not null,
  path        text not null,
  mime_type   text not null,
  size_bytes  integer not null,
  uploaded_by uuid references public.farm_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists farm_photos_field_idx on public.farm_photos (field_id);

alter table public.farm_users enable row level security;
alter table public.farm_sessions enable row level security;
alter table public.farm_invites enable row level security;
alter table public.farm_fields enable row level security;
alter table public.farm_members enable row level security;
alter table public.farm_photos enable row level security;

-- Private: photos are only ever read through the server.
insert into storage.buckets (id, name, public)
values ('farm-photos', 'farm-photos', false)
on conflict (id) do update set public = false;

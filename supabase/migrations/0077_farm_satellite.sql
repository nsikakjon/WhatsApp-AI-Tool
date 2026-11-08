-- Oko satellite crop health: the last Sentinel-2 greenness (NDVI) results for
-- each field, kept so the satellite service is asked at most a few times a
-- day per field. See docs/FARM.md (Satellite crop health).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0076). Running it again is safe.

create table if not exists public.farm_satellite (
  field_id      text primary key references public.farm_fields(id) on delete cascade,
  -- Which boundary the results are for; a new boundary means fetching again.
  boundary_key  text not null,
  -- [{date, mean, min, max, clear}] for the last 12 months, oldest first.
  series        jsonb not null default '[]'::jsonb,
  fetched_at    timestamptz not null default now(),
  -- The coloured picture of the latest clear date, in the farm-photos bucket.
  image_date    date,
  image_path    text
);

alter table public.farm_satellite enable row level security;

-- Site reporter: location pins and a logo for the PDF report.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0004_site_reporter.sql).

-- A location pin sent from site is logged as an update of kind 'location'.
alter table public.site_updates
  add column if not exists latitude          double precision,
  add column if not exists longitude         double precision,
  -- Only filled in when the sender picked a named place in WhatsApp.
  add column if not exists location_name     text,
  add column if not exists location_address  text;

alter table public.site_updates drop constraint if exists site_updates_kind_check;
alter table public.site_updates
  add constraint site_updates_kind_check check (kind in ('text', 'photo', 'voice', 'location'));

-- Where the site's logo is saved in Supabase Storage (bucket "site-photos").
-- A manager sets it by sending a picture with the caption "logo".
alter table public.site_sites
  add column if not exists logo_path text;

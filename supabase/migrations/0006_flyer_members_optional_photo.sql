-- Phase 3: members imported from a spreadsheet may not have a photo yet.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0005_flyers.sql). Their flyers show their initials until a photo is added.

alter table public.flyer_members alter column photo_path drop not null;

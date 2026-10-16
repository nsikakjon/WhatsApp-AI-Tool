-- Free trial for new flyer groups.
-- Run this once in Supabase: SQL Editor > New query > paste > Run (after 0012),
-- BEFORE deploying the code that uses it.
-- New groups get the Standard plan free for 7 days or 30 finished flyers,
-- whichever comes first (the numbers are in src/products/flyer/plans.ts).

-- Finished flyers left in the group's free trial. Null = not on a trial
-- (every group that existed before this, and any group on a paid plan).
alter table public.flyer_groups
  add column if not exists trial_flyers_left integer check (trial_flyers_left >= 0);

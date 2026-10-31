-- Owner nudges for the quote bot: plan renewal reminders and grace period
-- (QUOTE_PLAN_RENEWALS), src/products/quote/renewals.ts.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0033). Running it again is safe and changes nothing.

-- When a paid plan ends unpaid, it keeps working until plan_grace_until.
-- renewal_notice_for / renewal_notice_step remember which reminder was last
-- sent for which end date, so none goes twice.
alter table public.quote_businesses
  add column if not exists plan_grace_until timestamptz,
  add column if not exists renewal_notice_for timestamptz,
  add column if not exists renewal_notice_step smallint not null default 0;

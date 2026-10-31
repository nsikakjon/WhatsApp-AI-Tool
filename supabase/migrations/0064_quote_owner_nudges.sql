-- Owner nudges for the quote bot: plan renewal reminders and grace period
-- (QUOTE_PLAN_RENEWALS, renewals.ts), usage drop warnings
-- (QUOTE_USAGE_DROP_ALERTS, usage-drop.ts) and promo code offers
-- (QUOTE_OFFERS, offers.ts), all in src/products/quote.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0033 and 0041). Running it again is safe and changes nothing.

-- When a paid plan ends unpaid, it keeps working until plan_grace_until.
-- renewal_notice_for / renewal_notice_step remember which reminder was last
-- sent for which end date, so none goes twice.
alter table public.quote_businesses
  add column if not exists plan_grace_until timestamptz,
  add column if not exists renewal_notice_for timestamptz,
  add column if not exists renewal_notice_step smallint not null default 0;

-- When yarnOga was last told this business's orders or chats dropped, so it
-- hears at most once every 30 days.
alter table public.quote_businesses
  add column if not exists usage_drop_alerted_at timestamptz;

-- When this business was last sent the COMEBACK win-back code (at most every 90 days).
alter table public.quote_businesses
  add column if not exists winback_sent_at timestamptz;

-- The two offer codes, quote bot only. They start switched OFF: the
-- percentages below are suggestions waiting for jay's approval. Change
-- percent_off on the row if needed, then switch each on with
-- "promo LIMITUP on" / "promo COMEBACK on" on WhatsApp (or tick active here).
-- Each owner can use each code once, on the first month of a plan.
insert into public.promo_codes (code, percent_off, max_uses, active, product)
values
  ('LIMITUP', 20, null, false, 'quote'),
  ('COMEBACK', 30, null, false, 'quote')
on conflict (code) do nothing;

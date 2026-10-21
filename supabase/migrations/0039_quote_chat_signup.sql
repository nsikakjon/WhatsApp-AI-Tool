-- Sign-up by WhatsApp chat for the quote bot: a business owner messages the
-- yarnOga quotes number, gives their business name, what they sell and their
-- prices, and their business is created on the Free plan (switched off until
-- their own number is connected).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql and 0021_quote_plans.sql).
-- Nothing uses it until QUOTE_SIGNUP_PHONE_NUMBER_ID is set on Railway.

create table if not exists public.quote_signups (
  -- The owner's WhatsApp number: one business per number.
  wa_id         text primary key,
  step          text not null default 'name' check (step in ('name', 'about', 'prices', 'done')),
  business_name text,
  description   text,
  -- The drafted price list waiting for the owner's YES, in the setup screen's CSV format.
  draft_csv     text,
  business_id   uuid references public.quote_businesses(id) on delete set null,
  -- Chatting with their own bot as a customer would (nothing is saved).
  trying        boolean not null default false,
  -- AI drafts and test replies used today, so one person can't run up the AI bill.
  ai_day        date,
  ai_used       integer not null default 0,
  created_at    timestamptz not null default now(),
  signed_up_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists quote_signups_signed_up_at_idx on public.quote_signups (signed_up_at) where signed_up_at is not null;

alter table public.quote_signups enable row level security;

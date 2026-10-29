-- Run this once in Supabase (SQL Editor > New query > paste > Run), after 0056. Running it again is safe.
--
-- yarnOga's welcome and setup-tip emails (docs/EMAILS.md). Only our own
-- customers are here: quote business owners, flyer group admins, and the site
-- reporter and lead qualifier clients Jay sets up. Never a business's customers.

create table if not exists public.email_contacts (
  id               uuid primary key default gen_random_uuid(),
  -- Which product's emails they get: quote, flyer, site or leads.
  product          text not null check (product in ('quote', 'flyer', 'site', 'leads')),
  -- The quote business or flyer group id (or a name Jay chooses for site and leads clients).
  account_id       text not null,
  -- Their WhatsApp number, so "stop emails" from it unsubscribes. Empty when we don't know it.
  wa_id            text not null default '',
  first_name       text,
  email            text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- When the bot asked for an email, and when they said no.
  asked_at         timestamptz,
  declined_at      timestamptz,
  -- Agreeing to tips and agreeing to receipts are separate (Nigeria Data
  -- Protection Act). Each keeps when, where and the exact words they saw.
  tips_at          timestamptz,
  tips_source      text,
  tips_wording     text,
  receipts_at      timestamptz,
  receipts_source  text,
  unsubscribed_at  timestamptz,
  -- Day 0 of their series: the first time the account was live after they agreed.
  series_started_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (product, account_id, wa_id)
);

create index if not exists email_contacts_wa_id_idx on public.email_contacts (wa_id) where wa_id <> '';
create index if not exists email_contacts_due_idx on public.email_contacts (product)
  where tips_at is not null and unsubscribed_at is null and email is not null;

-- Each email of a series goes to a contact once: sent, skipped because
-- they'd already done that step, or failed because Resend refused the address.
-- Resend's id is kept to look a send up.
create table if not exists public.email_sends (
  contact_id  uuid not null references public.email_contacts(id) on delete cascade,
  email_key   text not null,
  status      text not null check (status in ('sent', 'skipped', 'failed')),
  resend_id   text,
  created_at  timestamptz not null default now(),
  primary key (contact_id, email_key)
);

create index if not exists email_sends_sent_idx on public.email_sends (created_at) where status = 'sent';

alter table public.email_contacts enable row level security;
alter table public.email_sends enable row level security;

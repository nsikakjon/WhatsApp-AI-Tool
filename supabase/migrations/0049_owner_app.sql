-- The owners' and staff web app at /app (app.yarnoga.com), OWNER_APP=true.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020, 0030, 0037 and 0045). Running it again is safe.
--
-- What it adds:
--   app_users           who can open a business's app: its owner and staff
--   app_login_tokens    one-time login links sent on WhatsApp ("app")
--   quote_bank_accounts a business's bank accounts (for invoices and payouts)
--   quote_alert_numbers extra WhatsApp numbers that get new-order alerts
--   price list extras   category, unit and production time on each product
--   business extras     the public WhatsApp number (for posters) and the
--                       secret key in the Google Sheets export link

-- People who can log in. The owner's row is made the first time they ask
-- for a login link from the business's owner number; the owner adds staff.
-- One person (WhatsApp number) can work for more than one business.
create table if not exists public.app_users (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.quote_businesses(id) on delete cascade,
  wa_id          text not null check (wa_id ~ '^[0-9]{8,15}$'),
  name           text,
  role           text not null default 'staff' check (role in ('owner', 'staff')),
  -- scrypt hash "scrypt$<salt>$<hash>"; null until they set a password.
  password_hash  text,
  -- Raised by "log out everywhere" and password changes: older logins stop working.
  session_epoch  integer not null default 0,
  active         boolean not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  unique (business_id, wa_id)
);
create index if not exists app_users_wa_id_idx on public.app_users (wa_id) where active;

-- Only a hash of each link's secret is kept, so a database leak can't log anyone in.
create table if not exists public.app_login_tokens (
  token_hash  text primary key,
  user_id     uuid not null references public.app_users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists app_login_tokens_user_idx on public.app_login_tokens (user_id, created_at desc);

create table if not exists public.quote_bank_accounts (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.quote_businesses(id) on delete cascade,
  bank_name            text not null,
  -- Paystack's bank code, when the bank was picked from Paystack's list.
  bank_code            text,
  account_number       text not null check (account_number ~ '^[0-9]{10}$'),
  account_name         text not null,
  -- The account printed on invoices (one per business).
  is_primary           boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (business_id, account_number, bank_name)
);
create unique index if not exists quote_bank_accounts_one_primary
  on public.quote_bank_accounts (business_id) where is_primary;

create table if not exists public.quote_alert_numbers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  wa_id        text not null check (wa_id ~ '^[0-9]{8,15}$'),
  name         text,
  created_at   timestamptz not null default now(),
  unique (business_id, wa_id)
);

alter table public.quote_products add column if not exists category text;
-- What one is, e.g. "piece", "pack of 100", "plate".
alter table public.quote_products add column if not exists unit text;
-- Working days to make it, shown to the owner and on product cards.
alter table public.quote_products add column if not exists lead_time_days integer
  check (lead_time_days is null or (lead_time_days >= 0 and lead_time_days <= 365));

-- The number customers message, as digits (Meta's Phone number ID isn't a phone number).
alter table public.quote_businesses add column if not exists whatsapp_number text
  check (whatsapp_number is null or whatsapp_number ~ '^[0-9]{8,15}$');
-- Part of the private Google Sheets export link; changing it turns the old link off.
alter table public.quote_businesses add column if not exists sheet_key text
  default replace(gen_random_uuid()::text, '-', '');
update public.quote_businesses set sheet_key = replace(gen_random_uuid()::text, '-', '') where sheet_key is null;

alter table public.app_users enable row level security;
alter table public.app_login_tokens enable row level security;
alter table public.quote_bank_accounts enable row level security;
alter table public.quote_alert_numbers enable row level security;

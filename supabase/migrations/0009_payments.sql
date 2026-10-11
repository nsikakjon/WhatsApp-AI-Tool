-- Online payments (Flutterwave payment links), shared by every product.
-- Run this once in Supabase: SQL Editor > New query > paste > Run (after 0008).
--
-- One row per payment link we send. It starts "pending" and becomes "paid"
-- exactly once, when Flutterwave confirms the money arrived. The unique
-- columns are what stop a retried webhook from activating anything twice.

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  -- Our reference for the payment, sent to Flutterwave and echoed back to us.
  tx_ref         text not null unique,
  -- Which product asked for the payment, e.g. 'flyer'.
  product        text not null,
  -- WhatsApp number of the person paying (international format, digits only).
  wa_id          text not null,
  -- What the payment is for, read by the product once it's paid,
  -- e.g. {"groupId": "...", "plan": "standard", "months": 1}.
  purpose        jsonb not null default '{}'::jsonb,
  -- Amount in kobo (₦1 = 100 kobo), always looked up from the database.
  amount_kobo    bigint not null check (amount_kobo > 0),
  currency       text not null default 'NGN',
  status         text not null default 'pending' check (status in ('pending', 'paid')),
  provider       text not null default 'flutterwave',
  -- Flutterwave's own transaction id, saved once it's paid.
  provider_tx_id text unique,
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);

create index if not exists payments_wa_id_idx on public.payments (wa_id, created_at desc);

alter table public.payments enable row level security;

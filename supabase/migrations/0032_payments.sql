-- Online payments through Paystack, shared by every product.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
--
-- One row per checkout link we send. It starts "pending" and becomes "paid"
-- exactly once, when Paystack confirms the money arrived. The unique columns
-- stop a retried webhook from activating anything twice.

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  -- Our reference, sent to Paystack and echoed back, e.g. yarnoga-flyer-<uuid>.
  reference    text not null unique,
  -- Which product asked for the payment, e.g. 'flyer'.
  product      text not null,
  -- WhatsApp number of the person paying (international format, digits only).
  wa_id        text not null,
  -- What the payment is for, read by the product once paid,
  -- e.g. {"groupId": "...", "plan": "standard", "months": 3}.
  purpose      jsonb not null default '{}'::jsonb,
  -- Kobo (₦1 = 100 kobo), always looked up from the database.
  amount_kobo  bigint not null check (amount_kobo > 0),
  status       text not null default 'pending' check (status in ('pending', 'paid')),
  -- Paystack's own transaction id, saved once paid.
  paystack_id  text unique,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);

create index if not exists payments_wa_id_idx on public.payments (wa_id, created_at desc);

alter table public.payments enable row level security;

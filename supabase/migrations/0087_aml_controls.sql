-- Run this once in Supabase (SQL Editor > New query > paste > Run). Running it again is safe.
--
-- Anti-money-laundering controls (docs/AML_POLICY.md):
-- 1. Pay-link limits for shops yarnOga hasn't verified yet (QUOTE_PAYLINK_LIMITS,
--    src/products/quote/paylinks.ts): what a shop's pay links and payout
--    top-ups have taken since a date. Amounts are hundredths of the shop's currency.
-- 2. On each business's verification: the owner's answer to the politically
--    exposed person question, the last sanctions screening, and yarnOga's
--    switch to pause its online payments and payouts.
-- 3. Verification records are kept even if a business row is deleted by
--    mistake: the law asks for 5 years after the relationship ends.

create index if not exists payments_paid_business_idx
  on public.payments ((purpose->>'businessId'), paid_at)
  where status = 'paid';

-- Order, ticket and monthly payments by pay link.
create or replace function public.paylink_paid_since(p_business_id text, p_since timestamptz)
returns bigint
language sql
stable
as $$
  select coalesce(sum(amount_kobo), 0)::bigint
  from public.payments
  where status = 'paid'
    and purpose->>'businessId' = p_business_id
    and paid_at >= p_since
    and (product = 'monthly' or (product = 'quote' and purpose->>'kind' = 'order'));
$$;

-- Money added to the payout balance (rider and staff payouts).
create or replace function public.payout_topups_since(p_business_id text, p_since timestamptz)
returns bigint
language sql
stable
as $$
  select coalesce(sum(amount_kobo), 0)::bigint
  from public.payments
  where status = 'paid'
    and product = 'payouts'
    and purpose->>'businessId' = p_business_id
    and paid_at >= p_since;
$$;

alter table public.quote_business_verifications
  add column if not exists pep boolean,
  add column if not exists payments_paused boolean not null default false,
  add column if not exists paused_note text,
  add column if not exists screening jsonb,
  add column if not exists screened_at timestamptz;

alter table public.quote_business_verifications drop constraint if exists quote_business_verifications_business_id_fkey;
alter table public.quote_business_verifications add constraint quote_business_verifications_business_id_fkey
  foreign key (business_id) references public.quote_businesses(id) on delete restrict;
alter table public.quote_business_documents drop constraint if exists quote_business_documents_business_id_fkey;
alter table public.quote_business_documents add constraint quote_business_documents_business_id_fkey
  foreign key (business_id) references public.quote_businesses(id) on delete restrict;
alter table public.quote_verification_events drop constraint if exists quote_verification_events_business_id_fkey;
alter table public.quote_verification_events add constraint quote_verification_events_business_id_fkey
  foreign key (business_id) references public.quote_businesses(id) on delete restrict;

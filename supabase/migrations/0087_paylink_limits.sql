-- Run this once in Supabase (SQL Editor > New query > paste > Run). Running it again is safe.
--
-- Pay-link limits for shops yarnOga hasn't verified yet (QUOTE_PAYLINK_LIMITS,
-- src/products/quote/paylinks.ts): how much a shop's order and monthly-payment
-- links have taken since a date. Amounts are hundredths of the shop's
-- currency, like every other price.
create index if not exists payments_paid_business_idx
  on public.payments ((purpose->>'businessId'), paid_at)
  where status = 'paid';

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

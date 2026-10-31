-- AI reply top-ups for the quote bot (QUOTE_AI_TOPUPS, src/products/quote/topups.ts).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0026 and 0032). Running it again is safe and changes nothing.
--
-- A business that has used its plan's AI replies for the month can buy a
-- pack of extra replies by Paystack link instead of upgrading. The extra
-- replies are added to the Lagos month they're paid in and end with it.

-- The packs on sale. Prices in kobo (₦1 = 100 kobo). The pack below is an
-- example waiting for jay's approval: change or add rows here, never in code.
create table if not exists public.quote_ai_packs (
  code        text primary key,
  name        text not null,
  replies     integer not null check (replies > 0),
  price_kobo  bigint not null check (price_kobo > 0),
  active      boolean not null default true,
  sort_order  integer not null default 0
);

alter table public.quote_ai_packs enable row level security;

insert into public.quote_ai_packs (code, name, replies, price_kobo, sort_order)
values ('ai-1000', '1,000 AI replies', 1000, 200000, 1)
on conflict (code) do nothing;

-- One row per pack paid for. The Paystack reference is the key, so a retried
-- webhook can never add the same pack twice.
create table if not exists public.quote_ai_topups (
  reference    text primary key references public.payments(reference),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  month        date not null,
  pack_code    text not null,
  replies      integer not null check (replies > 0),
  amount_kobo  bigint not null check (amount_kobo > 0),
  created_at   timestamptz not null default now()
);

create index if not exists quote_ai_topups_month_idx on public.quote_ai_topups (business_id, month);

alter table public.quote_ai_topups enable row level security;

-- Saves a paid pack and returns true, or false when the reference was already
-- saved. Once a business runs out, the messages its bot answers with the
-- simple menu still go on the count, so the count is brought back down to
-- what the plan and earlier packs allowed: the owner gets every reply they paid for.
create or replace function public.quote_add_ai_topup(
  p_reference text, p_business_id uuid, p_month date, p_pack_code text,
  p_replies integer, p_amount_kobo bigint, p_plan_limit integer
)
returns boolean
language plpgsql
as $$
declare
  v_before integer;
begin
  select coalesce(sum(replies), 0) into v_before
    from public.quote_ai_topups where business_id = p_business_id and month = p_month;

  insert into public.quote_ai_topups (reference, business_id, month, pack_code, replies, amount_kobo)
  values (p_reference, p_business_id, p_month, p_pack_code, p_replies, p_amount_kobo)
  on conflict (reference) do nothing;
  if not found then
    return false;
  end if;

  update public.quote_ai_usage
     set credits_used = least(credits_used, p_plan_limit + v_before), updated_at = now()
   where business_id = p_business_id and month = p_month;
  return true;
end;
$$;

revoke all on function public.quote_add_ai_topup(text, uuid, date, text, integer, bigint, integer) from public, anon, authenticated;
grant execute on function public.quote_add_ai_topup(text, uuid, date, text, integer, bigint, integer) to service_role;

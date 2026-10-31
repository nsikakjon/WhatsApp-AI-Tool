-- What each of our WhatsApp numbers costs us in AI and voice notes each month.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0043_whatsapp_sent_counts.sql), BEFORE setting SHOP_COSTS=true on
-- Railway. Running it again is safe.
--
-- Every AI reply adds the tokens Anthropic billed, and every voice note adds
-- the seconds Groq billed, to a running total per number per Lagos month.
-- The cost is worked out in code when the call is made, at that model's
-- price, and kept in millionths of a US dollar (1,000,000 = $1) so small
-- amounts add up exactly. The dashboard turns it into naira at the latest
-- dollar rate in the profit and loss entries, and adds Meta's message fees
-- from whatsapp_sent_counts.

create table if not exists public.usage_costs (
  -- The number's "Phone number ID". Empty = the main number (WHATSAPP_PHONE_NUMBER_ID).
  business_number_id text not null,
  -- The Lagos month, stored as its first day (e.g. 2026-10-01).
  month              date not null,
  ai_replies         integer not null default 0 check (ai_replies >= 0),
  ai_input_tokens    bigint not null default 0 check (ai_input_tokens >= 0),
  ai_output_tokens   bigint not null default 0 check (ai_output_tokens >= 0),
  ai_micro_usd       bigint not null default 0 check (ai_micro_usd >= 0),
  voice_notes        integer not null default 0 check (voice_notes >= 0),
  voice_seconds      integer not null default 0 check (voice_seconds >= 0),
  voice_micro_usd    bigint not null default 0 check (voice_micro_usd >= 0),
  updated_at         timestamptz not null default now(),
  primary key (business_number_id, month)
);

alter table public.usage_costs enable row level security;

-- Adds one AI reply or one voice note to this month's total, in one step, so
-- two messages arriving together can't overwrite each other's count.
create or replace function public.add_usage_cost(
  p_number_id text,
  p_month date,
  p_ai_replies integer,
  p_ai_input_tokens bigint,
  p_ai_output_tokens bigint,
  p_ai_micro_usd bigint,
  p_voice_notes integer,
  p_voice_seconds integer,
  p_voice_micro_usd bigint
)
returns void
language sql
as $$
  insert into public.usage_costs as u (
    business_number_id, month, ai_replies, ai_input_tokens, ai_output_tokens, ai_micro_usd,
    voice_notes, voice_seconds, voice_micro_usd
  )
  values (
    coalesce(p_number_id, ''), p_month, p_ai_replies, p_ai_input_tokens, p_ai_output_tokens, p_ai_micro_usd,
    p_voice_notes, p_voice_seconds, p_voice_micro_usd
  )
  on conflict (business_number_id, month) do update set
    ai_replies       = u.ai_replies + excluded.ai_replies,
    ai_input_tokens  = u.ai_input_tokens + excluded.ai_input_tokens,
    ai_output_tokens = u.ai_output_tokens + excluded.ai_output_tokens,
    ai_micro_usd     = u.ai_micro_usd + excluded.ai_micro_usd,
    voice_notes      = u.voice_notes + excluded.voice_notes,
    voice_seconds    = u.voice_seconds + excluded.voice_seconds,
    voice_micro_usd  = u.voice_micro_usd + excluded.voice_micro_usd,
    updated_at       = now();
$$;

revoke all on function public.add_usage_cost(text, date, integer, bigint, bigint, bigint, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.add_usage_cost(text, date, integer, bigint, bigint, bigint, integer, integer, bigint) to service_role;

-- Counts the WhatsApp messages each of our numbers sends each month.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0015_inbox.sql). Running it again is safe.
--
-- Since 1 October 2026 Meta charges for messages a business sends, after the
-- first 1,000 a month on each number. This keeps a running total per number
-- per Lagos calendar month, so the dashboard shows which numbers are past the
-- free 1,000 and the quote bot can warn an owner nearing their plan's
-- allowance ("bot_messages" in quote_plan_features).
--
-- The database adds to the total itself every time a sent message is saved,
-- so every product and the staff inbox are counted without extra code, and a
-- message saved twice by mistake is rejected before it is counted.

create table if not exists public.whatsapp_sent_counts (
  -- The number's "Phone number ID". Empty = the main number (WHATSAPP_PHONE_NUMBER_ID),
  -- for messages saved without one, as in the staff inbox.
  business_number_id text not null,
  -- The Lagos month, stored as its first day (e.g. 2026-10-01).
  month              date not null,
  sent               integer not null default 0 check (sent >= 0),
  -- So the owner is warned once at 80% and once at 100% each month.
  warned_near        boolean not null default false,
  warned_full        boolean not null default false,
  updated_at         timestamptz not null default now(),
  primary key (business_number_id, month)
);

alter table public.whatsapp_sent_counts enable row level security;

create or replace function public.count_whatsapp_sent()
returns trigger
language plpgsql
as $$
begin
  insert into public.whatsapp_sent_counts as c (business_number_id, month, sent)
  values (
    coalesce(new.business_number_id, ''),
    date_trunc('month', new.created_at at time zone 'Africa/Lagos')::date,
    1
  )
  on conflict (business_number_id, month)
  do update set sent = c.sent + 1, updated_at = now();
  return new;
end;
$$;

revoke all on function public.count_whatsapp_sent() from public, anon, authenticated;

drop trigger if exists messages_count_sent on public.messages;
create trigger messages_count_sent
  after insert on public.messages
  for each row
  when (new.direction = 'outbound')
  execute function public.count_whatsapp_sent();

-- Fill in the totals for messages sent before this was run.
insert into public.whatsapp_sent_counts (business_number_id, month, sent)
select coalesce(business_number_id, ''),
       date_trunc('month', created_at at time zone 'Africa/Lagos')::date,
       count(*)
from public.messages
where direction = 'outbound'
group by 1, 2
on conflict (business_number_id, month)
do update set sent = excluded.sent, updated_at = now();

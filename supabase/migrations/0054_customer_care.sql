-- Run this once in Supabase (SQL Editor > New query > paste > Run), after 0053. Running it again is safe.
--
-- Customer care features (docs/CUSTOMER_CARE.md).

-- Payment reminders: at most two per confirmed, unpaid order.
alter table public.quote_orders add column if not exists pay_reminders smallint not null default 0
  check (pay_reminders between 0 and 2);
alter table public.quote_orders add column if not exists pay_reminded_at timestamptz;
create index if not exists quote_orders_unpaid_idx
  on public.quote_orders (business_id, confirmed_at) where status = 'confirmed';
-- Each business can switch them off in the app.
alter table public.quote_businesses add column if not exists pay_reminders_on boolean not null default true;

-- About your business: what the bot may tell customers, and opening hours
-- as {"mon": ["08:00", "18:00"], ...} (Lagos time); a missing day is closed.
alter table public.quote_businesses add column if not exists about text check (char_length(about) <= 1500);
alter table public.quote_businesses add column if not exists opening_hours jsonb;

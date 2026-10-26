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

-- The owner's morning summary: on unless switched off, sent once a day.
alter table public.quote_businesses add column if not exists daily_summary_on boolean not null default true;
alter table public.quote_businesses add column if not exists summary_sent_on date;

-- Ratings: one "How did we do?" per paid order, answered with a button
-- (5 = great, 3 = OK, 1 = not good). Each business can switch them off.
alter table public.quote_orders add column if not exists rating_asked_at timestamptz;
alter table public.quote_orders add column if not exists rating smallint check (rating between 1 and 5);
alter table public.quote_orders add column if not exists rated_at timestamptz;
create index if not exists quote_orders_rated_idx on public.quote_orders (business_id, rated_at) where rating is not null;
alter table public.quote_businesses add column if not exists ratings_on boolean not null default true;

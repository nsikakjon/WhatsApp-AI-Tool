-- Visitor counter for yarnoga.com, shown on the owner dashboard.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
--
-- Each row is one page view. No cookies and no IP addresses are stored:
-- "visitor" is a code made from the visitor's IP and browser that changes
-- every day, so it can count people per day but can't follow anyone over
-- time or be turned back into an IP address.

create table if not exists public.site_visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Lagos calendar day of the visit.
  day date not null,
  -- The page, e.g. "/flyers.html" (never the part after "?").
  path text not null,
  -- The site the visitor came from, e.g. "www.google.com"; null when unknown.
  referrer_host text,
  visitor text not null
);

create index if not exists site_visits_day_idx on public.site_visits (day);

-- Only the app (service role) can read or write it; the views follow the
-- same rule (security_invoker), so the public key sees nothing.
alter table public.site_visits enable row level security;

-- Daily page views and visitors.
create or replace view public.site_visit_days with (security_invoker = true) as
select day, count(*)::int as views, count(distinct visitor)::int as visitors
from public.site_visits
group by day;

-- Most viewed pages and top places visitors came from, last 30 days.
create or replace view public.site_visit_pages_30d with (security_invoker = true) as
select path, count(*)::int as views
from public.site_visits
where created_at >= now() - interval '30 days'
group by path;

create or replace view public.site_visit_sources_30d with (security_invoker = true) as
select coalesce(referrer_host, '') as source, count(*)::int as views
from public.site_visits
where created_at >= now() - interval '30 days'
group by coalesce(referrer_host, '');

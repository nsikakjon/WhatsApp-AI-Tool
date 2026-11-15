-- The last day of a partner's event (set on the dashboard's Partnerships
-- page). The day after it, the partner's keyword on the yarnOga quotes line
-- is switched off and its organisers see only the event report in the owner
-- app; 30 days later their organiser logins stop working. The shop's orders,
-- tickets and chats are kept. See src/dashboard/partner-access.ts.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0089_partner_packages.sql). Running it again is safe.

alter table public.partner_leads add column if not exists ends_on date;

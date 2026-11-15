-- Event organisers in the owner app (src/owner/roles.ts): a partner's team,
-- added from the dashboard's Partnerships page, who see chats, orders, ticket
-- buyers and ticket money but not settings, bank details or the plan.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0058_staff_roles.sql). Running it again is safe.

alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check
  check (role in ('owner', 'manager', 'cashier', 'rider', 'organiser'));

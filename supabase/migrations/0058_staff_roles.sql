-- Staff roles in the owner app (app.yarnoga.com): manager, cashier, rider.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0049). Running it again is safe.
--
-- Until now everyone the owner added was "staff", who could see everything
-- except Settings, Export and Verify business. They become managers, which
-- is the same access. Cashiers see chats, orders and customers but not the
-- takings; riders see only orders and deliveries.

alter table public.app_users drop constraint if exists app_users_role_check;
update public.app_users set role = 'manager' where role = 'staff';
alter table public.app_users alter column role set default 'cashier';
alter table public.app_users add constraint app_users_role_check
  check (role in ('owner', 'manager', 'cashier', 'rider'));

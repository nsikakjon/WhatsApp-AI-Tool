-- Branches for the quote bot: a business with more than one WhatsApp number
-- (e.g. a shop in Ikeja and one in Lekki). Each branch has its own number,
-- price list and alert number, is on its main business's plan, and its orders
-- show on the main business's order board. Growth allows 3 numbers in all.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0020_quote_businesses.sql). Nothing uses it until QUOTE_BRANCHES=true.

alter table public.quote_businesses
  add column if not exists branch_of uuid references public.quote_businesses(id) on delete set null
  check (branch_of is null or branch_of <> id);

create index if not exists quote_businesses_branch_of_idx on public.quote_businesses (branch_of) where branch_of is not null;

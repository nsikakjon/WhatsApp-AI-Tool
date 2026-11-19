-- Commission for someone who sells yarnOga for us (e.g. Prosper, our Uyo
-- lead): their share of plan payments from shops that signed up with their
-- code, for each shop's first 12 months. Set and tracked on the dashboard's
-- Partnerships page, in the partner's package (Commission).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0089_partner_packages.sql). Running it again is safe.

alter table public.partner_leads
  add column if not exists commission_percent integer check (commission_percent between 1 and 99),
  -- What we've paid them so far, in kobo.
  add column if not exists commission_paid_kobo bigint not null default 0 check (commission_paid_kobo >= 0);

-- Prosper (code PROSPER): 25%, agreed 19 Nov 2026.
update public.partner_leads set commission_percent = 25
where promo_code = 'PROSPER' and commission_percent is null;

-- Business verification (KYB): owners send their registration details and
-- documents from the app (Settings > Verify your business); Jay reviews them
-- on the compliance page (/compliance). See docs/COMPLIANCE.md.
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0049). Running it again is safe.

create table if not exists public.quote_business_verifications (
  business_id         uuid primary key references public.quote_businesses(id) on delete cascade,
  -- company (RC number), business_name (BN number) or individual (not registered yet)
  entity_type         text check (entity_type in ('company', 'business_name', 'individual')),
  registered_name     text,
  rc_number           text,
  tin                 text,
  address             text,
  -- The director or proprietor whose ID is uploaded.
  director_name       text,
  contact_email       text,
  status              text not null default 'not_started'
                      check (status in ('not_started', 'submitted', 'more_info', 'approved', 'rejected')),
  -- What Jay told the owner with the last decision.
  review_note         text,
  submitted_at        timestamptz,
  reviewed_at         timestamptz,
  -- The last CAC registry check (Dojah), when one was run.
  registry_result     jsonb,
  registry_checked_at timestamptz,
  updated_at          timestamptz not null default now()
);

create table if not exists public.quote_business_documents (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  kind         text not null check (kind in ('certificate', 'status_report', 'memart', 'id', 'address', 'licence', 'other')),
  file_path    text not null,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   integer not null,
  uploaded_at  timestamptz not null default now()
);
create index if not exists quote_business_documents_business_idx on public.quote_business_documents (business_id, uploaded_at);

-- Who did what, and when: submissions, decisions and registry checks.
create table if not exists public.quote_verification_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.quote_businesses(id) on delete cascade,
  action       text not null,
  note         text,
  actor        text not null,
  created_at   timestamptz not null default now()
);
create index if not exists quote_verification_events_business_idx on public.quote_verification_events (business_id, created_at desc);

alter table public.quote_business_verifications enable row level security;
alter table public.quote_business_documents enable row level security;
alter table public.quote_verification_events enable row level security;

-- Private: documents are only ever read through the server, never by a public link.
insert into storage.buckets (id, name, public)
values ('kyb-documents', 'kyb-documents', false)
on conflict (id) do update set public = false;

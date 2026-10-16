-- Owner test screen (/bot-test): the good/poor marks the owner gives the
-- bot's answers before going live.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
--
-- Each row is one mark. Marking the same question again adds a new row; the
-- screen shows the newest mark for each question.

create table if not exists public.bot_test_marks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Which bot was tested: 'quote' or 'leads'.
  bot text not null,
  -- Which business's bot, once the platform runs several businesses.
  -- Empty for now (the one business on this server).
  business_id text,
  question text not null,
  answer text not null,
  mark text not null check (mark in ('good', 'poor')),
  -- The owner's note on what the answer should have said (optional).
  note text
);

create index if not exists bot_test_marks_bot_idx on public.bot_test_marks (bot, created_at desc);

-- Only the app (service role) can read or write it.
alter table public.bot_test_marks enable row level security;

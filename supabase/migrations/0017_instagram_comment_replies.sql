-- Instagram comment auto-reply for the real estate leads.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Only needed if you switch on INSTAGRAM_AUTOREPLY (see docs/INSTAGRAM.md).
--
-- One row per Instagram comment the bot has answered. The comment id is
-- unique, so a webhook Meta sends twice never gets two replies.

create table if not exists public.instagram_comment_replies (
  -- Instagram's id for the comment.
  comment_id          text primary key,
  -- The post the comment is on.
  media_id            text,
  commenter_id        text,
  commenter_username  text,
  comment_text        text,
  -- 'working' while replying, 'done' when both replies went out, 'failed' if
  -- Instagram refused (it is tried again when Meta re-sends the webhook).
  status              text not null default 'working' check (status in ('working', 'done', 'failed')),
  -- When the private message with the WhatsApp link was sent.
  private_reply_at    timestamptz,
  -- When the public reply under the comment was posted.
  public_reply_at     timestamptz,
  -- Why the last try failed, if it did.
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists instagram_comment_replies_created_idx
  on public.instagram_comment_replies (created_at desc);

alter table public.instagram_comment_replies enable row level security;

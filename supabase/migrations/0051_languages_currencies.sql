-- Languages and currencies (docs/FRENCH.md): each quote business and flyer
-- group picks the language of the bot's fixed messages, and each quote
-- business its currency. Run this once in Supabase: SQL Editor > New query >
-- paste > Run (after 0049). Running it again is safe.
--
-- Amounts stay whole hundredths in the same columns: kobo for naira,
-- centimes for CFA francs (CFA prices are whole francs, so they end in 00).

alter table public.quote_businesses add column if not exists language text not null default 'en'
  check (language in ('en', 'fr'));
alter table public.quote_businesses add column if not exists currency text not null default 'NGN'
  check (currency in ('NGN', 'XOF', 'XAF'));

-- Reply with a voice note when the customer sent one (docs/VOICE_REPLIES.md).
alter table public.quote_businesses add column if not exists voice_replies boolean not null default false;

alter table public.flyer_groups add column if not exists language text not null default 'en'
  check (language in ('en', 'fr'));

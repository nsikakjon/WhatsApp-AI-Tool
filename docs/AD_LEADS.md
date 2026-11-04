# Leads from WhatsApp ads

When someone taps a **Click-to-WhatsApp** ad on Facebook or Instagram (or a
Facebook post's WhatsApp button) and sends a message, Meta tells the bot which
ad it was. With this switched on, the bot saves that on whichever number was
messaged, so it works for yarnOga's own numbers and for every client's number.

## What you get

- **/dashboard > Leads from ads**: every ad on every number, with leads in the
  last 7, 30 and 90 days, chats in their free window right now, and how many
  messages went out free this month.
- **Owner app > Ads** (owners only): the same for the business's own number,
  plus how many of each ad's people got a quote and how many ordered.

A person is counted once per ad, however many messages they send. A quote or
order counts for an ad only if it came after their first message from it.
The Ad ID matches the one in Meta Ads Manager, so you can set each ad's leads
against what it cost.

## The free 72-hour window

If the business replies within 24 hours of someone's first message from an
ad, Meta charges nothing for messages to that person for the next **72
hours**, templates included (follow-ups, receipts, offers). The database
starts the window when the first reply is saved. Messages inside it are
counted separately as free, so they don't add to the Meta fees on the
dashboard or to a plan's bot message allowance.

WhatsApp's 24-hour rule still applies inside the window: once a person has
been quiet for a day, only approved templates reach them. They're just free.
People who message from WhatsApp Web or the desktop app don't open a window.

## Switching it on

1. Run `supabase/migrations/0072_ad_leads.sql` in Supabase (SQL Editor > New
   query > paste > Run). Running it again is safe.
2. On Railway, set `AD_LEADS=true`.

Nothing else is needed: Meta already sends the ad details on every number.

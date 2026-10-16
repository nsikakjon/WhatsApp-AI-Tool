# Quote follow-up reminders

Some customers ask for a quote and then go quiet. With follow-ups switched on,
the quote bot sends them **one** polite reminder the next day, so a forgotten
quote can still become an order.

What the customer sees (example):

> Hi Ada, just checking in on your quote KP-1042 from KahnPrints (total ₦15,000).
>
> Reply YES to place the order, or tell me what you'd like to change.
> Reply STOP if you'd rather not get reminders.

If they reply YES, the order is confirmed exactly as if they had replied the
day before. If they reply STOP, they never get a quote reminder from that
business again (they can still ask for quotes).

## The rules

- **One reminder per quote, ever.** A quote is marked before its reminder is
  sent, so a restart or a retried run can never send a second one.
- **Only quotes still waiting for a YES.** Confirmed, paid and cancelled
  quotes never get a reminder.
- **Never to someone who has already replied.** If the customer messaged us at
  all after the quote, they're in the conversation and get no reminder.
- **Never after STOP**, and never in a chat that staff have taken over (from
  the inbox or by replying from the WhatsApp Business app).
- **Daytime only:** reminders go out between 8am and 8pm Lagos time. One that
  falls due at night waits for the morning.
- **Old quotes are left alone.** A quote more than two days past its reminder
  time is never reminded, so switching this on doesn't message old customers.
- **The amount comes from the saved quote** in the database, never from the AI.

## WhatsApp's 24-hour rule (why a template is needed)

WhatsApp only lets a business send an ordinary message within 24 hours of the
customer's last message. A next-day reminder is almost always outside that
window, so it must be a **message template** that Meta has approved.

- Customer still inside the 24 hours: they get the ordinary message above.
- Outside the 24 hours, template set up: they get the template.
- Outside the 24 hours, no template: no reminder (the quote is marked skipped).

Meta charges a small fee for each template message (see Meta's WhatsApp
pricing for Nigeria). Ordinary messages inside the 24 hours are free.

## Switching it on

1. In Supabase, run `supabase/migrations/0027_quote_follow_ups.sql`
   (SQL Editor > New query > paste > Run). Run 0020 first if you haven't.
2. Create the template in Meta (below) and wait for it to be approved.
3. On Railway, add these variables:
   - `QUOTE_FOLLOW_UPS=true`
   - `QUOTE_FOLLOW_UP_TEMPLATE_NAME=quote_reminder` (the template's exact name)
   - `QUOTE_FOLLOW_UP_TEMPLATE_LANGUAGE=en` (only if you chose a language other than English)
   - `QUOTE_FOLLOW_UP_HOURS=24` (optional; 24 is the default)

The Railway log line "Server listening ..." then shows `quote reminders: on`.

To switch it off again, set `QUOTE_FOLLOW_UPS=false`. Nothing else changes.

## Creating the template in Meta

1. Open **WhatsApp Manager** (business.facebook.com > WhatsApp Manager) and
   pick the WhatsApp account that owns the quote bot's number.
2. Go to **Message templates > Create template**.
3. Category: **Utility** (it's about a quote the customer asked for). Meta
   may move it to Marketing, which costs a little more per message; that's fine.
4. Name: `quote_reminder`. Language: **English**.
5. Body (copy exactly, keeping the `{{1}}` to `{{4}}` markers):

   ```
   Hi {{1}}, this is {{2}}. Your quote {{3}} (total {{4}}) is still waiting for you. Reply YES to place the order, or tell us what you'd like to change. Reply STOP if you'd rather not get reminders.
   ```

   Meta asks for example values. Use: `Ada`, `KahnPrints`, `KP-1042`, `₦15,000`.
6. No header, no buttons. Submit, and wait for **Active** (usually minutes,
   sometimes up to a day).

The bot fills in the four values itself: the customer's WhatsApp name (or
"there"), the business name, the quote number and the quote total.

**Other businesses on their own WhatsApp account:** a template belongs to one
WhatsApp account. If a business's number sits in a different WhatsApp account
(for example one connected through the sign-up page), create the same
`quote_reminder` template in that account too, or its customers outside the
24 hours won't get a reminder.

## Changing the timing per business

Business #1 (the main number) uses `QUOTE_FOLLOW_UP_HOURS`.

Every other business can have its own timing in the `quote_businesses` table
(Supabase > Table editor), column `follow_up_hours`:

- empty: use `QUOTE_FOLLOW_UP_HOURS`
- a number of hours from 1 to 168 (one week), e.g. `48` for two days
- `0`: no reminders for that business

## Plans

Follow-ups are meant for the Starter plan and above. When plan features are
switched on, the reminder run asks the business's plan before sending (see the
note next to `allowed:` in `src/index.ts`). Until then every business with the
switch on gets reminders.

## Checking what happened

Each quote in `quote_orders` shows the outcome in `follow_up_status`:
`sent`, `skipped` (replied, STOP, staff took over, or no template) or `failed`
(WhatsApp refused it, e.g. the template isn't approved yet), with the time in
`follow_up_at`. Customers who replied STOP are in `quote_follow_up_opt_outs`.

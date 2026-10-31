# Quote bot plans

Each business on the quote and order bot can be on a plan. Prices live in the
`quote_plans` table and what each plan includes lives in `quote_plan_features`,
both in kobo or plain counts, so they change in Supabase, never in code.

| | Free | Starter | Pro | Growth | Enterprise |
|---|---|---|---|---|---|
| Monthly | ₦0 | ₦7,000 | ₦23,000 | ₦73,000 | ₦298,000 |
| Paid yearly (per month) | | ₦6,250 | ₦19,250 | ₦61,750 | ₦253,000 |
| Confirmed orders a month | 50 | Unlimited | Unlimited | Unlimited | Unlimited |
| AI replies a month | 500 | 2,500 | 7,500 | 25,000 | 100,000 |
| Price list rows | 20 | 100 | Unlimited | Unlimited | Unlimited |
| Voice notes, invoices, reminders, staff inbox | | ✓ | ✓ | ✓ | ✓ |
| Delivery zones, riders, tracking | | | ✓ | ✓ | ✓ |
| Broadcasts a month | | | 1,000 | 5,000 | 20,000 |
| "Powered by yarnOga" line | Shown | | | | |
| Set up for you | ₦25,000 extra | ₦25,000 extra | ₦25,000 extra | Included | Included |

Standard (₦45,000) can no longer be bought. A business already on it keeps it
and gets everything Pro has.

## Switching it on

1. In Supabase, run `supabase/migrations/0034_quote_new_plans.sql` (after 0025
   and 0033).
2. On Railway, `QUOTE_PLAN_FEATURES=true` makes the features above count.
   Without it, only the order limit and the yarnOga line apply.

## How a business gets a plan

- The owner sends `plan` to see their plan and prices, then
  `upgrade pro` (a month) or `upgrade pro yearly` (a year) for a Paystack link.
  Once paid, the plan runs until a date, then the business drops back to Free.
- Or set it by hand: `plan_code` on the business's row in `quote_businesses`
  (no end date), or `QUOTE_PLAN` on Railway for the business on the main number.
- A business with no plan (how KahnPrints runs) gets everything with no limits.

## Changing a price or limit

Edit the row in Supabase > Table Editor: `quote_plans` for prices (kobo:
₦7,000 is 700000), `quote_plan_features` for limits (`usage_limit`, empty for
no cap) and whether a plan has a feature (`included`).

## Bot messages (Meta's fee)

Since 1 October 2026 Meta charges for each message a WhatsApp number sends
after its first 1,000 a month (about ₦9 to ₦14 each in Nigeria). Meta bills
whoever owns the number: yarnOga for numbers in our own WhatsApp accounts,
the business for a number it connected through the sign-up page.

1. In Supabase, run `supabase/migrations/0043_whatsapp_sent_counts.sql`. From
   then on the database counts every message each number sends, per Lagos
   month, and fills in the past months too. The dashboard shows the counts.
2. Nothing else changes until you give a plan an allowance. No plan has one
   yet. After a month of real counts, add a row to `quote_plan_features` with
   `feature` = `bot_messages`, `included` = true and `usage_limit` = the number
   of messages a month, for example:

   ```sql
   insert into public.quote_plan_features (plan_code, feature, included, usage_limit)
   values ('starter', 'bot_messages', true, 1500)
   on conflict (plan_code, feature) do update set usage_limit = excluded.usage_limit;
   ```

With an allowance set (and `QUOTE_PLAN_FEATURES=true`), the owner gets a
WhatsApp note at 80% and again at 100%, and their `plan` reply shows
"Bot messages this month: 812 of 1500". The bot never stops answering
customers. Numbers the business connected itself are never checked, since
Meta bills them directly. Each number (a branch included) has its own
allowance, like Meta's free 1,000.

## AI reply top-ups

A business that has used its plan's AI replies for the month (for example the
Free plan's 500) can buy a pack of extra replies instead of upgrading. The
owner sends *top up* to their bot, or presses the button on the owner app's
dashboard once they're at 80%, and pays by Paystack link. The replies are
added to that month as soon as the payment goes through, and end on the last
day of the month. If the bot had already switched to the simple menu, the
messages it answered that way don't eat into the new pack.

1. In Supabase, run `supabase/migrations/0063_quote_ai_topups.sql`.
2. Check the pack and its price in `quote_ai_packs` (₦2,000 for 1,000
   replies is only an example). Prices are in kobo: ₦2,000 is `200000`. To
   change it, or add a bigger pack:

   ```sql
   insert into public.quote_ai_packs (code, name, replies, price_kobo, sort_order)
   values ('ai-5000', '5,000 AI replies', 5000, 800000, 2)
   on conflict (code) do update set replies = excluded.replies, price_kobo = excluded.price_kobo, name = excluded.name;
   ```

   Set `active` to false to stop selling a pack.
3. In Railway, add `QUOTE_AI_TOPUPS` = `true`. It needs `QUOTE_PLAN_FEATURES`
   and `PAYSTACK_SECRET_KEY` already on.

Each Paystack payment is saved once under its reference, so a payment that
Paystack reports twice never adds the replies twice. Packs are in naira for
every business.

## Usage this month (owner app)

The dashboard's "Plan usage this month" card shows orders, AI replies and bot
messages against the plan's limits. At 80% of a limit the owner sees a
warning there, with the top-up buttons for AI replies (owner only) and a
pointer to *plan* to upgrade. Managers see the card but can't buy.

## Limit alerts on WhatsApp

With `QUOTE_LIMIT_ALERTS` = `true` on Railway (no migration needed):

- The owner's warnings about AI replies, bot messages and orders arrive with
  one-tap buttons: *Upgrade to Starter* (or whichever plan is next up), and
  *Top up AI replies* for AI replies when top-ups are on.
- There's an extra heads-up when the month's orders reach 80% of the plan's
  limit (order 40 of 50 on Free), on top of the warnings on the last five.
- When the orders run out, the customer is still told the team will contact
  them, the owner gets the order details, and the bot stays out of that chat
  for 24 hours so the owner can finish the sale without the bot talking over
  them. When AI replies run out, the bot keeps going with menu replies as before.

## Renewals and the grace period

Plans are paid by Paystack link for a month or a year, so there's no saved
card to charge again: the owner renews by paying a new link. If a card is
declined, the owner can try again on the same Paystack page, and every
reminder below brings fresh *Renew for a month* and *Renew for a year* buttons.

With `QUOTE_PLAN_RENEWALS` = `true`:

1. Three days before a paid plan ends, the owner gets a reminder.
2. If it ends unpaid, the business keeps its plan for `QUOTE_PLAN_GRACE_DAYS`
   more days (3 unless set) and the owner is told when it will drop to Free.
3. On the last day of the grace period, one more reminder.
4. After that, the business is on Free. The owner gets buttons to come back,
   and yarnOga gets a WhatsApp alert.

A renewal paid during the grace period carries on from the old end date, so
the grace days aren't free extra time. Reminders go out between 8am and 8pm
Lagos time. WhatsApp only lets the bot message an owner who has written to it
in the last day; when it can't, yarnOga gets the alert instead so someone can
call them. yarnOga's alerts go to `QUOTE_SIGNUP_ALERT_WA_ID` (from the sign-up
number), or to `QUOTE_OWNER_WA_ID` if that isn't set.

To switch it on: run `supabase/migrations/0064_quote_owner_nudges.sql`, then
add `QUOTE_PLAN_RENEWALS` = `true` on Railway.

## Usage drop warnings

With `QUOTE_USAGE_DROP_ALERTS` = `true` (after migration 0064), the bot looks
at every business on a paid plan at 10am each day. If its confirmed orders or
its customer chats over the last 30 days are 40% or more below the 30 days
before, yarnOga gets a WhatsApp alert with the numbers and the owner's number,
so someone can call before they cancel. A business needs at least 10 orders
or 20 chats in the earlier month to count, and is flagged at most once every
30 days.

With `QUOTE_USAGE_DROP_CHECKIN` = `true` as well, the owner also gets a short
check-in from their own bot, with *All good* and *Please call me* buttons.
*Please call me* sends yarnOga another alert. The check-in only goes when the
owner has messaged their bot in the last day (WhatsApp's rule).

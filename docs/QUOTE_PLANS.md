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

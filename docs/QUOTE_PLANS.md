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

# Business advisor

A page in the owner app (**Business advisor**, under Marketing, owners only)
and a WhatsApp command (**advice**, from the owner's own number) that answer
five questions about the shop from its own sales:

| Question               | What the owner gets                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| How is my shop doing?  | Money in, orders, average order, repeat customers and unpaid orders for the last 30 days, against the 30 before. |
| Who stopped buying?    | Customers with 2 or more orders and nothing in 30 days, biggest spenders first, and a message to win them back. In the app, each customer has a Send on WhatsApp button with their first name filled in. |
| How do I sell more?    | Best sellers (30 days), items with no sale in 60 days, and the busiest and quietest weekdays (8 weeks).          |
| Check my prices        | Price list prices below the cost price, sales made below cost (30 days), bulk prices nobody bought enough to reach (90 days), and items with no cost price yet. |
| Write my status post   | A WhatsApp status post and an ad caption from the best sellers and their lowest list prices.                     |

## Where the numbers come from

Every figure is worked out in code from the database (orders, counter sales
and the price list), in kobo, and written out by code. The AI (the quote
bot's model and key) only writes a few lines of advice around those figures.
If the AI writes any number that isn't in the figures it was given (a price,
a target, a discount), that advice is thrown away and the owner sees the
figures alone. The status post falls back to a simple post written by code.

Cost prices come from the price list's cost column (counter sales,
`QUOTE_COUNTER_SALES`). Without them, "Check my prices" says it can't check
against cost and only looks at bulk prices.

Answers are in the shop's language (English or French).

## Plans and limits

Pro and above (row `business_advisor` in `quote_plan_features`). Each plan
gets a number of written answers a month: Pro 30, Growth 100, Enterprise 300.
After that the answers still show the figures, without the advice, until the
next month. Asking the same question again within 3 hours shows the saved
answer and doesn't count. A business with no plan (KahnPrints) has no limit.
Change the numbers in the table, not in code.

## Switching it on

1. Run `supabase/migrations/0093_business_advisor.sql` in Supabase.
2. Add `QUOTE_BUSINESS_ADVISOR` = `true` in Railway.

It's off until both are done.

# More businesses on the quote bot

The quote and order bot is a yarnOga product that any business can use. Each
business gets:

- its own WhatsApp number (customers message that number),
- its own price list (prices in kobo, read from the database, never from the AI),
- its own owner alert number (new orders and "paid" commands),
- its own orders and order prefix (e.g. MC-1001),
- its own logo on invoices and receipts.

The business already on the main WhatsApp number (today KahnPrints) is
**business #1**. It keeps its settings in Railway (`QUOTE_BUSINESS_NAME`,
`QUOTE_OWNER_WA_ID`, `QUOTE_ORDER_PREFIX`, ...), exactly as before.

## Switching it on

1. In Supabase, run `supabase/migrations/0020_quote_businesses.sql`
   (SQL Editor > New query > paste > Run). It gives every existing product and
   order to business #1, so nothing changes for its customers.
2. On Railway, add `QUOTE_MULTI_BUSINESS=true`.

With the switch off (the default), the bot ignores the businesses table
completely and runs exactly as it did before.

## Adding a business

Until the setup screen is ready, add a row to `quote_businesses` in Supabase
(Table editor):

| Column            | Example                         |
| ----------------- | ------------------------------- |
| `name`            | Mama Cakes                      |
| `description`     | a bakery                        |
| `order_prefix`    | MC (capital letters, up to 6)   |
| `phone_number_id` | the number's "Phone number ID" from Meta |
| `owner_wa_id`     | owner's WhatsApp number, digits only, e.g. 2348012345678 |

Then load its price list into `quote_products`, `quote_variants` and
`quote_price_tiers`, setting `business_id` on each product to the new
business's id. The number must also be connected to the app in Meta, with
webhooks switched on, like the other numbers (see docs/META_SETUP.md).

Changes to a business's settings take effect within a minute.

## The demo shop (try the quote bot)

`supabase/seed/demo_quote_business.sql` adds **yarnOga Demo Shop**, a made-up
business with a small sample price list (T-shirts, mugs, cupcakes, ...), so
people can try the quote bot. It answers on the demo number
**+234 701 326 2131**, which the website's "try it" buttons point at.

That number is no longer used by the site reporter: `SITE_PHONE_NUMBER_ID` on
Railway must **not** be set to its Phone number ID.

To switch the demo on:

1. In Meta (WhatsApp Manager), add +234 701 326 2131 to the app's WhatsApp
   account, verify it with the SMS code, and register it (POST
   `/{phone-number-id}/register` with a 6-digit PIN), as for the flyer number
   in docs/META_SETUP.md (step by step: docs/META_PORTFOLIO.md step 4). Turn
   on **Subscribe webhooks** for it. Note its
   **Phone number ID**.
2. Run migration 0020, then `supabase/seed/demo_quote_business.sql`, in Supabase.
3. In Table editor > `quote_businesses`, open "yarnOga Demo Shop": paste the
   Phone number ID into `phone_number_id`, optionally put your number in
   `owner_wa_id` to see the order alerts, and set `active` to true.
4. On Railway, set `QUOTE_MULTI_BUSINESS=true`.

The demo starts switched off, so running the seed changes nothing until step 3.

## Good to know

- Order numbers count up across all businesses (MC-1007 may follow KP-1006),
  so an order number never points at two businesses' orders.
- Setting `active` to false makes the bot stop answering that business's
  number. It never answers as another business.

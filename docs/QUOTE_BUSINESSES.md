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

## Adding a business (setup screen)

1. In Supabase, run `supabase/migrations/0023_quote_price_list_import.sql`
   (after 0020).
2. On Railway, add `QUOTE_SETUP_PASSWORD` (a password you invent, at least 12
   characters).
3. Open `https://<your-railway-url>/quote-setup`. The browser asks for the
   password; the username can be anything.
4. Press **Add a business** and fill in its name, what it does, an order
   prefix (e.g. MC for MC-1001), the WhatsApp **Phone number ID** Meta shows
   for its number, and the owner's alert number. Tick "Answer customers on
   this number" when you're ready for it to go live.
5. Add its price list: upload a CSV file, paste a Google Sheet link (shared
   as "Anyone with the link"), or type it in. One row per price:

   | Product          | Option                  | Minimum order | From quantity | Price |
   | ---------------- | ----------------------- | ------------- | ------------- | ----- |
   | Branded T-shirts | white, one-colour print | 10            | 10            | 5000  |
   | Branded T-shirts | white, one-colour print | 10            | 50            | 4200  |
   | Custom cakes     | any size                | 1             |               |       |

   Prices are in naira (they're saved in kobo). Leave the price empty for
   items the team prices by hand: the bot passes those requests to the owner.
   The screen shows the list back, with what's new, changed or taken off,
   and only saves when you press **Save this price list**. The new list
   replaces the whole old one; items taken off are switched off, not deleted,
   so old orders still read correctly.

The main number's business (#1) keeps its name and alert number on Railway,
so the screen only lets you change its price list.

The number must also be connected to the app in Meta, with webhooks switched
on, like the other numbers (see docs/META_SETUP.md). Changes to a business's
settings take effect within a minute.

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
   in docs/META_SETUP.md. Turn on **Subscribe webhooks** for it. Note its
   **Phone number ID**.
2. Run migration 0020, then `supabase/seed/demo_quote_business.sql`, in Supabase.
3. On the setup screen (or in Table editor > `quote_businesses`), open
   "yarnOga Demo Shop": fill in the Phone number ID, optionally your number as
   the alert number to see the order alerts, and switch it on.
4. On Railway, set `QUOTE_MULTI_BUSINESS=true`.

The demo starts switched off, so running the seed changes nothing until step 3.

## Good to know

- Order numbers count up across all businesses (MC-1007 may follow KP-1006),
  so an order number never points at two businesses' orders.
- Setting `active` to false makes the bot stop answering that business's
  number. It never answers as another business.

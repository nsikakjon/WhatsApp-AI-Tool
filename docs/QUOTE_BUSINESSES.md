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

### Let AI draft the price list (optional)

With `QUOTE_SETUP_AI_DRAFT=true` on Railway (and `ANTHROPIC_API_KEY` set), the
price list page also has **Let AI draft it**. The owner describes what they
sell with their prices (e.g. "Cupcakes N600 each, box of 6 for N3,500"), or
adds up to 3 photos or screenshots of their price list. The AI writes it out
as rows in the "type it here" box. Nothing is saved: the owner corrects the
rows, presses **Check it**, then **Save this price list**, as above.

- The AI is told to copy prices, never to make them up. When the owner only
  typed text, any price that isn't in their text is left empty, so the AI
  can't slip in a price of its own. Prices read from a photo can't be checked
  that way, so the page asks the owner to check every price.
- At most `QUOTE_SETUP_AI_DRAFTS_PER_DAY` drafts a day (default 30) across
  all businesses, so the AI bill stays small.

The main number's business (#1) keeps its name and alert number on Railway,
so the screen only lets you change its price list.

The number must also be connected to the app in Meta, with webhooks switched
on, like the other numbers (see docs/META_SETUP.md). Changes to a business's
settings take effect within a minute.

## The demo shop (try the quote bot)

`supabase/seed/demo_quote_business.sql` adds **yarnOga Demo Shop**, a made-up
business with a small sample price list (T-shirts, mugs, cupcakes, ...), so
people can try the quote bot. It answers on the demo number
**+234 704 897 1600**, which the website's "try it" buttons point at.

That number is no longer used by the site reporter: `SITE_PHONE_NUMBER_ID` on
Railway must **not** be set to its Phone number ID.

To switch the demo on:

1. In Meta (WhatsApp Manager), add +234 704 897 1600 to the app's WhatsApp
   account, verify it with the SMS code, and register it (POST
   `/{phone-number-id}/register` with a 6-digit PIN), as for the flyer number
   in docs/META_SETUP.md (step by step: docs/META_PORTFOLIO.md step 4). Turn
   on **Subscribe webhooks** for it. Note its
   **Phone number ID**.
2. Run migration 0020, then `supabase/seed/demo_quote_business.sql`, in Supabase.
3. On the setup screen (or in Table editor > `quote_businesses`), open
   "yarnOga Demo Shop": fill in the Phone number ID, optionally your number as
   the alert number to see the order alerts, and switch it on.
4. On Railway, set `QUOTE_MULTI_BUSINESS=true`.

The demo starts switched off, so running the seed changes nothing until step 3.

## Sign-up by chat

The demo number is also where new businesses sign up, so an ad can simply say
"message us on WhatsApp". Anyone who sends **sign up** to it is asked for:

1. the business name,
2. what it sells (a few words),
3. a referral code, if they have one (any switched-on promo or referral code;
   **no** skips it),
4. its prices: typed, as a voice note, as a photo of the price list, as a
   CSV file, or as a link to a Google Sheet shared as "Anyone with the link".

For a spreadsheet, the bot offers a template to start from: a Google Sheet to
copy and a CSV file (`price-list-template.csv` on yarnoga.com). The setup
screen links to both too. A CSV file or Sheet link is read as it is, without
the AI.

The AI writes the prices out as a list and the bot shows it back. The owner
corrects anything in the chat ("make the box ₦3,500") or sends another photo,
and replies **YES** when it's right. Nothing is saved before that YES. Typed
or spoken prices the owner never actually said are left empty for them to
fill in, as on the setup screen.

On YES the business is added on the **Free plan**, switched off, with the
owner's WhatsApp number as its alert number. You get a WhatsApp message
(`QUOTE_SIGNUP_ALERT_WA_ID`). To put them live, connect their own number in
Meta, then on the setup screen fill in its Phone number ID and switch it on.

After signing up, the owner can send:

- **try** to chat with their own bot as a customer would. Test orders are kept
  in memory only, and the order alerts come to them so they see both sides.
  **done** ends it.
- **prices** to change the price list the same way.

A code given at sign-up is kept on the business (`referral_code`) and used on
its first upgrade without retyping it, so the business that shared it gets its
free month. If the code has ended or was already used by then, the upgrade is
simply at the full price.

Everyone else on the number gets the demo shop, and a first-time visitor's
first reply ends with an invitation to send "sign up".

Limits, so nobody can run up the AI bill or flood the list: one business per
WhatsApp number, 30 AI drafts and test replies per person a day, 200 drafts a
day overall, and 30 new businesses a day (any more are told the yarnOga team
will be in touch, and you get a message).

To switch it on: run migrations `0039_quote_chat_signup.sql` and
`0046_quote_signup_referral.sql`, make sure
`QUOTE_MULTI_BUSINESS=true`, and set `QUOTE_SIGNUP_PHONE_NUMBER_ID` to the demo
number's Phone number ID. The setup screen stays the place for big
spreadsheets, bulk edits and switching businesses on.

## Prices kept in step with a Google Sheet

With `QUOTE_PRICE_SHEETS=true` (and migration 0040), a price list saved from a
Google Sheet link (in the sign-up chat or on the setup screen) remembers that
link. Once a day the server reads the sheet again. If anything changed, the
owner gets a WhatsApp message, and nothing changes for customers until they
say so. The owner can send:

- **refresh** to check the sheet now and see what changed,
- **update prices** to use the changes,
- a Google Sheet link to start following that sheet,
- **stop sync** to stop.

Owners send these on their own number, or on the quotes number if theirs
isn't connected yet. The setup screen shows which sheet a business follows,
with a button to stop. Saving a list any other way stops following the sheet,
since the two no longer match.

The daily message is an ordinary WhatsApp message, so it only arrives if the
owner has messaged the bot in the last 24 hours. "refresh" always works.

### Extra columns

Owners can add their own columns (Colour, Sizes, Delivery time, ...). Each
item keeps them as details, and the bot uses them to answer customers'
questions. Only the first Price column sets prices: other price columns are
ignored, so a detail can never become a price.

## Good to know

- Order numbers count up across all businesses (MC-1007 may follow KP-1006),
  so an order number never points at two businesses' orders.
- Setting `active` to false makes the bot stop answering that business's
  number. It never answers as another business.

## Branches

A business with more than one WhatsApp number (a shop in Ikeja and one in
Lekki, say) can add the others as branches. Each branch is its own row with
its own number, price list and alert number; on the setup screen, pick the
main business under **Branch of**.

- A branch is on its main business's plan, and its AI replies count against
  the main business's allowance. Upgrading from a branch's chat pays for the
  main business.
- The main business's order board shows the branches' orders too.
- Free, Starter and Pro allow 1 number (no branches), Growth 3 in all, and
  Enterprise any number (`branches` in `quote_plan_features`).
- A branch can't have branches of its own.
- To start a branch with the same prices, download the main business's price
  list as CSV on the setup screen and upload it to the branch.

To switch it on, run `supabase/migrations/0038_quote_branches.sql` in Supabase
and add `QUOTE_BRANCHES=true` on Railway.

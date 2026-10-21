# Discount codes for a business's customers

Off unless `QUOTE_DISCOUNT_CODES=true`.

Each business on the quote bot can make its own discount codes for its
customers: a Christmas or Black Friday sale, or a code for an influencer to share
so the owner can see how many orders that influencer brought in.

(These are separate from yarnOga's own codes in `docs/PROMO_CODES.md`, which take
money off a business's yarnOga plan.)

## For the business owner

The owner sends these to their own bot:

| Send                                              | What happens                                              |
| ------------------------------------------------- | --------------------------------------------------------- |
| `new code XMAS 20%`                               | Makes XMAS: 20% off, no end date, no limit                 |
| `new code BLACKFRIDAY 30% until 29 Nov`           | Stops working at the end of 29 November                    |
| `new code TOLU10 10% limit 50`                    | Works for 50 orders (handy for an influencer)              |
| `new code BLACKFRIDAY 30% until 29 Nov limit 100` | Both                                                       |
| `codes`                                           | Every code, how many orders it brought in and money off    |
| `code XMAS off` / `code XMAS on`                  | Pauses it, or starts it again                              |

Sending `new code` with a name that already exists changes that code and switches
it back on. Discounts can be 1% to 90%. Names are letters and numbers, 4 to 20 of
them.

## For the customer

The customer asks for a quote as usual, then sends the code, e.g. `XMAS`. The bot
replies with the quote again, a discount line and the new total. They reply YES
as normal, and the invoice and receipt show the discount as its own line.

- The discount comes off the items only, never off delivery.
- A new quote starts without a code, so the customer sends it again.
- A quote holds a place on a limited code for a day. Confirmed and paid orders
  keep their place.
- If the code is paused, ended or used up, the customer is told so, and the quote
  stays as it was.

The discount is worked out from the code's row in the database
(`quote_apply_discount`), never by the AI.

## Going live

1. In Supabase: SQL Editor, New query, paste all of
   `supabase/migrations/0042_quote_discount_codes.sql`, Run.
2. In Railway, add `QUOTE_DISCOUNT_CODES=true`.
3. Test from the main number's owner phone: send `new code TEST10 10%`. From
   another phone, ask for a quote, then send `TEST10`. The total should drop by
   10%. Send `code TEST10 off` when you're done.

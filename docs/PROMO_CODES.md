# Promo codes and referral codes

## DAYONES: half price for the first 10 subscribers

**DAYONES** gives 50% off the **first month** of a paid plan, on any product
(yarnOga Flyers and the quote and order bot). It works for the first 10 people
who pay with it, once each.

People type the code at the end of their upgrade message:

- Flyers: `upgrade standard DAYONES`, or `upgrade standard 3 months DAYONES`
- Quote bot (business owners): `upgrade starter DAYONES`, or `upgrade starter yearly DAYONES`

The payment link they get is already discounted, and the reply says how much
they saved. On a longer payment only the first month is half price, so 3 months
of Standard (₦13,500) costs ₦11,250, and a year of Starter at ₦75,000 costs
₦71,875.

A place is held for a day when someone gets a discounted link, and kept for good
once they pay. If they don't pay within the day, the place goes back.

If the code is off, has run out, or the person has used it before, they get no
link, just a message saying why and that they can send the message again without
the code to pay full price.

### Turning it off, or letting more people use it

**From WhatsApp** (from a flyer owner number, `FLYER_OWNER_WA_IDS`), message the
flyer number:

| Send                      | What happens                                             |
| ------------------------- | -------------------------------------------------------- |
| `promos`                  | Each code, whether it's on, and how many places are left |
| `promo DAYONES off`       | Stops the code working straight away                     |
| `promo DAYONES on`        | Starts it again                                          |
| `promo DAYONES limit 20`  | Lets 20 people use it in total (instead of 10)           |
| `promo DAYONES limit none`| No limit                                                 |

**Or in Supabase**: Table Editor, `promo_codes`, the DAYONES row. Untick
`active` to switch it off; change `max_uses` to the number of people allowed
(empty means no limit). Changes work immediately, no redeploy needed.

To add another code later (say 30% off for 5 people), add a row in the same
table: `code` in capitals (letters and numbers only), `percent_off`, `max_uses`.
Set `product` to `flyer` or `quote` to limit it to one product.

## Referral codes for the quote and order bot

Off unless `QUOTE_REFERRALS=true`.

Each business on the quote bot gets its own code. The owner sends `referral` to
their bot and gets a code made from their business name, e.g. **KAHNP4821**,
plus how many businesses have used it.

- **The business that uses the code** gets **10% off its first month** when it
  upgrades: `upgrade starter KAHNP4821`.
- **The business that shared it** gets **a free month** once that payment goes
  through: another month of the plan it's paying for, or a month of Starter if
  it's on Free.

Each business can use a given code once, and a business can't use its own. The
main number's business (business #1, whose plan is set in Railway) doesn't get
a code or a reward, and neither does a business whose plan was set by hand with
no end date.

To change the 10% for one business, edit `percent_off` on its row in
`promo_codes` (its `referrer_business_id` is the business). To change the
default for all new codes, ask a developer to change the column default.

## Offers for quote bot owners (LIMITUP and COMEBACK)

Off unless `QUOTE_OFFERS=true` (needs migration 0064 and `PAYSTACK_SECRET_KEY`).

- **LIMITUP**: when a business uses up its month's orders or AI replies, the
  owner's warning says "Upgrade now with code LIMITUP for 20% off your first
  month". With `QUOTE_LIMIT_ALERTS` on, the Upgrade button already has the code
  in it, so it's one tap.
- **COMEBACK**: once a day at 11am, a business that isn't on a paid plan and
  has had no customer chats or orders for 30 days gets a win-back message with
  the code and a one-tap upgrade, at most once every 90 days. WhatsApp only
  lets the bot message an owner who has written to it in the last day, so
  usually yarnOga gets an alert with the code and the owner's number instead,
  to send it personally.

Both are normal promo codes: one use per owner, first month only. Migration
0064 adds them **switched off**, at 20% (LIMITUP) and 30% (COMEBACK). Those
numbers are suggestions: change `percent_off` on the row in `promo_codes` if
you want different amounts, then switch each on with `promo LIMITUP on` and
`promo COMEBACK on` (the same WhatsApp commands as DAYONES above). While a code
is off, nobody is offered it.

## Going live

1. In Supabase: SQL Editor, New query, paste all of
   `supabase/migrations/0041_promo_codes.sql`, Run. This creates the
   `promo_codes` table with DAYONES (50%, 10 people) already in it.
2. That's all DAYONES needs, as long as Paystack is already on
   (`PAYSTACK_SECRET_KEY` is set).
3. For referral codes, in Railway add `QUOTE_REFERRALS=true` (it also needs
   `QUOTE_MULTI_BUSINESS=true`).
4. Test: from a flyer group admin's phone, send `upgrade standard DAYONES` and
   check the link shows ₦2,250. Then send `promos` from your owner number: you
   should see 0 of 10 used and 1 holding an unpaid link.

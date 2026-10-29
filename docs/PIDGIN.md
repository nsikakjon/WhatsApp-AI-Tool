# Pidgin replies

The quote bot and the flyer bot answer in Nigerian Pidgin when a customer
writes to them in Pidgin. Nothing to switch on: it works as soon as this is
deployed.

## How it works

- **Spotting Pidgin.** The bot looks for words only Pidgin speakers use
  (*abeg*, *wetin*, *dey*, *una*, *I wan*, *how much e be*, *no wahala* and
  so on). On the quote bot the AI also says which language the customer is
  writing in, using the earlier chat when a message is just "yes" or "ok".
  A message that is English with one Nigerian word ("thanks boss",
  "please o") stays English.
- **Quote bot.** The welcome, quotes, confirmations, pay reminders, delivery
  questions, ratings and the AI's own short answers come back in Pidgin.
  Prices are still worked out in code from the price list, exactly as
  before.
- **Flyer bot.** The first hello, the three set-up steps, adding members,
  photo and logo replies and support come back in Pidgin. An admin can also
  send *pidgin* to switch, and *english* to switch back. Commands stay the
  same English words (*add*, *members*, *design*), and the full *help* list
  is in English.

## What stays in English

- Invoices, receipts and the flyers themselves (including birthday wishes).
  Pidgin is a chat language here, not a printed one.
- Messages to the business owner, riders and our own team.
- A business or flyer group can't pick Pidgin as its main language. It
  follows each customer.

## Changing a wording

Quote bot messages are in `src/products/quote/texts.ts` (the `pcm` block)
and the welcome in `src/products/quote/welcome.ts`. Delivery messages are in
`src/products/quote/delivery/texts.ts`. Flyer bot messages are the fourth
wording in each `tr(...)` in `src/products/flyer/index.ts`. A message with no
Pidgin wording goes out in English.

# Hausa replies

The quote bot and the flyer bot answer in Hausa when someone writes to them
in Hausa. It works the same way as Pidgin (see [PIDGIN.md](PIDGIN.md)).
Nothing to switch on: it works as soon as this is deployed.

## How it works

- **Spotting Hausa.** The bot looks for words that only show up in Hausa
  (*sannu*, *barka da*, *ina kwana*, *nawa*, *ina son*, *don Allah*,
  *na gode*, *guda*, *akwai* and so on), or the Hausa letters ɓ ɗ ƙ ƴ. On the
  quote bot the AI also says which language the customer is writing in, using
  the earlier chat when a message is just "yes" or "ok".
- **How it's written.** Plain letters, the way most people type Hausa on
  WhatsApp, and the polite *ku* to every customer, so the bot never has to
  guess whether it's talking to a man or a woman.
- **Quote bot.** The welcome, quotes, confirmations, pay reminders, delivery
  questions, ratings and the AI's own short answers come back in Hausa.
  Prices are still worked out in code from the price list, exactly as before.
  Buttons and words the bot listens for (*YES*, *Cancel*, *pickup*,
  *Confirm order*) stay in English, so they keep working.
- **Flyer bot.** The first hello, the three set-up steps, adding members,
  photo and logo replies and support come back in Hausa. An admin can also
  send *hausa* to switch, and *english* to switch back. Commands stay the
  same English words (*add*, *members*, *design*), and the full *help* list
  is in English.

## What stays in English

- Invoices, receipts and the flyers themselves (including birthday wishes).
- Messages to the business owner, riders and our own team.
- A business or flyer group can't pick Hausa as its main language. It
  follows each customer.
- **Voice replies.** Neither Google nor Microsoft has a Hausa voice yet, so a
  Hausa voice note gets its answer as text only. The bot still understands
  Hausa voice notes, though Whisper hears Hausa less reliably than English.

## Changing a wording

Quote bot messages are in `src/products/quote/texts.ts` (the `ha` block) and
the welcome in `src/products/quote/welcome.ts`. Delivery messages are in
`src/products/quote/delivery/texts.ts`. Flyer bot messages are the fifth
wording in each `tr(...)` in `src/products/flyer/index.ts`. A message with no
Hausa wording goes out in English.

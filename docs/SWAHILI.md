# Swahili replies

The quote bot and the flyer bot answer in Swahili when someone writes to them
in Swahili, for customers in Kenya, Tanzania, Uganda, Rwanda and Malawi. It
works the same way as Hausa (see [HAUSA.md](HAUSA.md)). Nothing to switch on:
it works as soon as this is deployed.

## How it works

- **Spotting Swahili.** The bot looks for words that only show up in Swahili
  (*habari*, *mambo*, *asante*, *tafadhali*, *bei gani*, *ngapi*, *nataka*,
  *naomba*, *karibu* and so on). On the quote bot the AI also says which
  language the customer is writing in, using the earlier chat when a message
  is just "yes" or "ok".
- **How it's written.** Plain, standard Swahili that reads naturally in
  Nairobi and Dar es Salaam, keeping everyday English words people already use
  on WhatsApp (*flyer*, *link*, *admin*, *group*, *invoice*).
- **Quote bot.** The welcome, quotes, confirmations, pay reminders, opening
  hours, delivery questions, ratings and the AI's own short answers come back
  in Swahili. Prices are still worked out in code from the price list, exactly
  as before. Buttons and words the bot listens for (*YES*, *Cancel*,
  *pickup*, *Confirm order*) stay in English, so they keep working.
- **Flyer bot.** The first hello, the three set-up steps, adding members,
  photo and logo replies and support come back in Swahili. An admin can also
  send *swahili* (or *kiswahili*) to switch, and *english* to switch back.
  Commands stay the same English words (*add*, *members*, *design*), and the
  full *help* list is in English.
- **Voice replies.** With Microsoft Azure (the recommended voice service) a
  Swahili voice note gets a Swahili voice note back, read by a Kenyan voice.
  Google has no Swahili voice, so on Google the answer comes as text only.

## What stays in English

- Invoices, receipts and the flyers themselves (including birthday wishes).
- Messages to the business owner, riders and our own team.
- A business or flyer group can't pick Swahili as its main language. It
  follows each customer.

## Changing a wording

Quote bot messages are in `src/products/quote/texts.ts` (the `sw` block) and
the welcome in `src/products/quote/welcome.ts`. Delivery messages are in
`src/products/quote/delivery/texts.ts`. Flyer bot messages are the sixth
wording in each `tr(...)` in `src/products/flyer/index.ts`. A message with no
Swahili wording goes out in English.

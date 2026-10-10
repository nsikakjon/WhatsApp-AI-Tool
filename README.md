# WhatsApp AI platform

A server that receives WhatsApp messages for a business and replies to them.
See [CLAUDE.md](CLAUDE.md) for the full plan, stack and rules.

## Phase 0

The echo bot repeats back whatever text it receives ("You said: ..."), and saves
every contact and message in Supabase. This proves the whole chain works:
WhatsApp > Meta > our server > database > reply. It still runs when
`ACTIVE_PRODUCT=echo` (the default).

## Phase 1 (in progress): KahnPrints quote and order bot

Runs when `ACTIVE_PRODUCT=quote`.

1. A customer says what they want ("500 A5 flyers, both sides"), typed or as a
   voice note (voice notes are turned into text by Groq Whisper when
   `GROQ_API_KEY` is set).
2. Claude Haiku works out which price-list items and how many. It never sees
   or writes prices.
3. The code prices it from the price list in Supabase and replies with an
   itemised quote and an order number (e.g. KP-1001).
4. The customer replies YES: the quote becomes a confirmed order and the owner
   gets a WhatsApp alert. Payment (Paystack) comes later.

To switch it on: run the `0002` and `0003` files in `supabase/migrations/`, then
`supabase/seed/kahnprints_price_list.sql` (the price list), then set the quote
bot variables from `.env.example` on Railway.

## Setup

1. [docs/META_SETUP.md](docs/META_SETUP.md): steps 1 to 4 (create the Meta app, get the test number).
2. [docs/DEPLOY_RAILWAY.md](docs/DEPLOY_RAILWAY.md): set up Supabase and deploy to Railway.
3. [docs/META_SETUP.md](docs/META_SETUP.md): steps 5 to 8 (connect the webhook and test).

## How the code is organised

```
src/
  index.ts               starts the server with real settings
  app.ts                 web routes: /health and /webhooks/whatsapp
  config.ts              reads settings from environment variables
  core/                  shared WhatsApp core (used by every product)
    product.ts           the contract every product follows
    db/store.ts          saves contacts and messages to Supabase
    whatsapp/
      webhook.ts         receives messages: verifies, de-duplicates, replies
      signature.ts       checks each webhook really came from Meta
      parse.ts           pulls messages out of Meta's webhook format
      client.ts          sends messages via the WhatsApp Cloud API
    money.ts             kobo <-> naira formatting
    voice/transcribe.ts  turns voice notes into text (Groq Whisper)
  products/
    echo/                Phase 0 test product: repeats your text back
    quote/               Phase 1 quote and order bot
      index.ts           the conversation: quote, confirm, cancel, owner alert
      understand.ts      the AI step (what does the customer want?)
      pricing.ts         works out prices from the price list
      store.ts           reads the price list, saves quotes and orders
supabase/migrations/     database tables (run in Supabase's SQL Editor)
```

## Commands

```bash
npm install     # install dependencies
npm run dev     # run locally (needs a filled-in .env, see .env.example)
npm test        # run automated checks
npm run build   # compile for production
npm start       # run the compiled server
```

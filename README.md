# WhatsApp AI platform

A server that receives WhatsApp messages for a business and replies to them.
See [CLAUDE.md](CLAUDE.md) for the full plan, stack and rules.

## Phase 0 (current)

The bot echoes back whatever text it receives ("You said: ..."), and saves every
contact and message in Supabase. This proves the whole chain works: WhatsApp >
Meta > our server > database > reply.

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
  products/
    echo/                Phase 0 test product: repeats your text back
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

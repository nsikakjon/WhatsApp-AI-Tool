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

## Phase 2 (in progress): construction site progress reporter

Runs on its own WhatsApp number when `SITE_PHONE_NUMBER_ID` is set. Setup steps:
[docs/SITE_REPORTER.md](docs/SITE_REPORTER.md).

1. Site staff registered in Supabase send updates: messages, photos or voice
   notes. Each is logged against their site; photos are saved to Supabase
   Storage.
2. Every evening (6pm Lagos time by default) Claude Haiku sorts the day's
   updates into a short report (work done, problems, materials needed, next
   steps) and it goes to the site's managers on WhatsApp. Managers can also
   send `report` any time.

## Real estate lead qualifier (in progress)

Runs on its own WhatsApp number when `LEADS_PHONE_NUMBER_ID` is set. Setup
steps: [docs/LEADS.md](docs/LEADS.md).

1. Someone enquires about a property. Claude Haiku asks what they want: buy
   or rent, property type, area, budget, timeline and how they'll pay.
2. The code scores each lead out of 100 (hot, warm or cold) and saves it in
   Supabase.
3. Agents get a WhatsApp alert for every hot lead, or whenever someone asks
   for an agent. Agents can text `leads` to see the latest enquiries.

## Phase 3 (in progress): birthday and event flyers for WhatsApp groups

Runs on its own WhatsApp number when `FLYER_PHONE_NUMBER_ID` is set. Setup and
commands: [docs/FLYERS.md](docs/FLYERS.md).

1. Group admins (alumni, friends groups) send members' photos captioned
   "add Ada Okafor, 14 March", or a whole list at once as a CSV file or Google
   Sheets link, and the group logo captioned "logo".
2. On each birthday morning the bot makes the member's birthday flyer, with a
   short message written by Claude Haiku, and sends it to the admins to
   forward to the group and tag the member.
3. Any other photo comes back as an event flyer: the photo with the logo and
   its caption on it.
4. Admins pick from eighteen designs (`design`), their own colour or their own
   background picture. Designs live in `src/products/flyer/themes.ts`.
5. With open sign-up, anyone who messages the number can set up their own
   group, and the owner gets an alert for each sign-up.

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
      outbox.ts          sends and saves alerts and scheduled messages
    schedule.ts          runs a task on a timer (daily reports, birthdays)
    money.ts             kobo <-> naira formatting
    voice/transcribe.ts  turns voice notes into text (Groq Whisper)
  products/
    echo/                Phase 0 test product: repeats your text back
    quote/               Phase 1 quote and order bot
      index.ts           the conversation: quote, confirm, cancel, owner alert
      understand.ts      the AI step (what does the customer want?)
      pricing.ts         works out prices from the price list
      store.ts           reads the price list, saves quotes and orders
    site/                Phase 2 construction site progress reporter
      index.ts           logs updates, answers "report", finds due reports
      summarise.ts       the AI step (sort the day's updates into a report)
      report.ts          formats the report, Lagos dates and times
      store.ts           sites, teams, updates, photos and sent reports
    leads/               real estate lead qualifier
      index.ts           the conversation, agent alerts, "leads" list
      understand.ts      the AI step (pull out answers, write next question)
      qualify.ts         the questions and the lead score
      store.ts           saves leads in Supabase
    flyer/               Phase 3 birthday and event flyers
      index.ts           admin commands, adding members, due birthday flyers
      render.ts          draws the flyer pictures
      themes.ts          the flyer designs (colours and layouts): edit here
      goldstars.ts       draws design 7 (gold stars)
      designs4.ts        draws designs 8 to 11 (gala, sunflowers, white and gold, calendar)
      designs7.ts        draws designs 12 to 18 (gold portrait, red and peach, rings, confetti, big date, polaroids)
      cutout.ts          cuts the person out of a photo (free model on our own server)
      dates.ts           reads birthdays, Lagos dates
      import.ts          reads member lists (CSV, Google Sheets) and photo links
      wish.ts            the AI step (a short birthday message)
      store.ts           groups, admins, members, photos and sent flyers
assets/fonts/            fonts used on flyers (open licence)
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

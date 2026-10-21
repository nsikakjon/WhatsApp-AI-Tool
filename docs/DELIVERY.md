# Delivery and rider tracking (quote bot)

With delivery switched on, the quote bot handles the trip from "YES" to the
customer's door:

1. The customer replies YES to a quote. The bot asks where to deliver, with a
   **Send location** button. They can drop a pin, type the address, or reply
   PICKUP.
2. The delivery fee comes from your **delivery zones** (a table in Supabase),
   never from the AI. The customer sees it as its own line with the new total
   and taps **Confirm order**. The invoice shows the delivery line too.
3. If the address isn't in any zone, you get a message and reply
   `fee KP-1001 2500` (naira). The customer then gets the total to confirm.
4. When the order is ready, you send `rider KP-1001 Musa`. Musa gets the job on
   WhatsApp (pickup, drop-off, map link, customer's number, whether it's paid)
   with **Picked up / Delivered / Couldn't deliver** buttons and a link to his
   rider page. The customer gets a link to follow him on a map.
5. Each tap tells the customer and you. Tapping twice does nothing the second time.

## What tracking can and can't do

- **WhatsApp does not pass live location to bots.** If a rider shares "live
  location" in the chat, we only get a note that it was sent, with no
  coordinates. A normal one-off location pin does come through, and the bot
  uses it to update the map once.
- So tracking runs through the **rider page**: while Musa keeps it open on his
  phone, it sends his position every 15 seconds and the customer's map moves.
- If he locks the phone or switches to another app, the browser stops sending.
  The page asks the phone to keep the screen on (most Android phones allow
  this; iPhones only on recent versions). Riders who won't keep it open can
  still tap the buttons, so the customer always gets "on the way" and
  "delivered" messages.
- Continuous background tracking needs a rider app installed on the phone.
  That is a bigger project and isn't part of this.

## Switching it on

1. In Supabase, run `supabase/migrations/0030_quote_delivery.sql` (SQL Editor >
   New query > paste > Run). It needs 0020 to have been run first.
2. Add your zones (below).
3. On Railway, add `QUOTE_DELIVERY=true` and `PUBLIC_URL` (your Railway
   address, e.g. `https://whatsapp-ai-tool-production.up.railway.app`, from
   Settings > Networking).
4. Make sure `QUOTE_BUSINESS_DETAILS` holds the pickup address: riders are told
   to collect from there.
5. From the owner's WhatsApp, add riders: `add rider Musa 0803 123 4567`. Ask
   each rider to send "hi" to the bot's number once.

With `QUOTE_DELIVERY` off (the default) nothing changes: customers confirm with
YES and you arrange delivery yourself.

Delivery is a Pro feature. With `QUOTE_PLAN_FEATURES=true`, a business on Free
or Starter confirms orders without the delivery step (see
[QUOTE_PLANS.md](QUOTE_PLANS.md)). A business with no plan, like KahnPrints,
always gets it.

## Delivery zones

Each row in `quote_delivery_zones` is one zone with one fee:

| column | what it is |
| --- | --- |
| `name` | what the customer sees, e.g. Ikeja |
| `areas` | area names that put a typed address in this zone, lowercase, e.g. `{ikeja,allen,opebi,alausa}` |
| `centre_lat`, `centre_lng`, `radius_m` | a circle on the map that puts a pin in this zone (find the centre by long-pressing in Google Maps) |
| `fee_kobo` | the fee in kobo: ₦2,000 is `200000` |

The migration has example Lagos rows to copy. When circles overlap, the one
with the nearest centre wins. When a typed address names two areas, the longer
name wins, so "Lekki Phase 1" beats "Lekki". Anything that doesn't match comes
to you to price.

## Owner commands

| send | does |
| --- | --- |
| `add rider Musa 0803 123 4567` | saves a rider |
| `riders` | lists your riders |
| `remove rider Musa` | stops offering Musa |
| `rider KP-1001 Musa` | sends Musa the job (or moves it from another rider) |
| `fee KP-1001 2500` | sets the delivery fee for an address outside your zones |
| `cancel delivery KP-1001` | stops the delivery and tells the customer and rider |
| `delivery` | shows this list |

## The 24-hour rule

WhatsApp only delivers ordinary messages to someone who messaged the bot in
the last 24 hours. Riders who haven't, and customers whose order goes out the
next day, need an approved template. Without one, the bot warns you and gives
you the job text to forward.

To add one, in WhatsApp Manager > Message templates, create a **Utility**
template, e.g. named `order_update`, language English, with this body:

> Hello, here is an update on order {{1}} from {{2}}:
>
> {{3}}
>
> Reply to this message if you have any questions.

Once approved, set `QUOTE_DELIVERY_TEMPLATE_NAME=order_update` on Railway.

## Courier companies

The delivery record has a `courier` column (today always `own_rider`) so a
courier company can be added later without changing the tables. As of October
2026:

- **Gokada** (Lagos only) offers a developer account at business.gokada.ng
  with test and live keys. This is the most likely first courier to add.
- **Kwik** has published an API since 2019, but the current address of its
  documentation is unclear; confirm with Kwik before relying on it.
- **Shipbubble** and **Sendbox** are aggregators with API keys, better suited
  to inter-state parcels than same-day bike delivery.
- **Glovo** runs an "On-Demand" courier service for businesses, but it has only
  been announced in European markets; there is no sign of it in Nigeria.

Each of these needs a business account and keys before anything can be built.

# Couriers through Shipbubble

This lets the bot deliver beyond a business's own riders. Shipbubble is one connection to many Nigerian couriers, including Kwik, Gokada and GIG.

## How it works

1. **The customer gives an address outside the business's zones.** Today the owner is asked to price it. With couriers on, the bot instead asks Shipbubble for real courier prices. It then offers the cheapest courier that **collects from the shop**, e.g. "Delivery to 5 Ring Road, Ibadan by Kwik (within 9 hrs): ₦3,063". The fee becomes a line on the quote and invoice.
   - The price is Shipbubble's own, never the AI's.
   - If no courier can do it, or Shipbubble is down, the owner prices it as before.
2. **The customer pays by pay link.**
   - The courier fee is split off to yarnOga's account, and the courier is **booked straight away**.
   - yarnOga's 2.5% fee is only on the business's part, not on the courier fee.
3. **The customer pays the owner directly** (bank transfer, cash, or "Mark paid" in the app). The courier fee is then with the owner:
   - the owner's paid message says so;
   - the owner replies *courier KP-1001* and gets a link to pay the fee;
   - the courier is booked as soon as it's paid.
4. **After booking:**
   - the customer gets a message with the courier's tracking link;
   - the owner is told to have the parcel packed and labelled with the order number.
5. **Pickup and delivery.** Shipbubble tells us when the parcel is picked up and delivered, and the customer and owner get the usual messages. Each update is checked against Shipbubble's signature, and each step is told only once.

yarnOga's Shipbubble wallet pays each courier. It only ever does so after the fee has been collected, so the wallet never goes out of pocket.

## What Jay needs to do

1. **Run the migration.** In Supabase, open SQL Editor > New query, paste `supabase/migrations/0053_couriers.sql`, and click Run.
2. **Create a Shipbubble account** at shipbubble.com, then:
   1. Copy the **API key** from its dashboard (Settings > API keys). Use the sandbox key (sb_sandbox_...) to try it out first.
   2. Fund the **wallet** for live use.
   3. Set the **webhook URL** to `https://<your Railway address>/webhooks/shipbubble`.
3. **On Railway**, add `SHIPBUBBLE_API_KEY` with that key. Never paste it anywhere else.
   - Optional: `SHIPBUBBLE_CONTACT_EMAIL`, which is the email Shipbubble gets for senders and receivers. When it's empty, the Paystack one is used.
   - Paystack and delivery (`QUOTE_DELIVERY`) must already be on.
4. **Switch couriers on for a business.** The owner does it in the app, under **Riders & delivery > Couriers for other areas > Turn couriers on**. For the main number, use `QUOTE_COURIER_DELIVERY=true`.
   - The business needs its address in Settings, because that's where the courier collects from.
   - It also needs an owner's number.
5. **Keep an eye on the wallet balance** in Shipbubble's dashboard. If a booking fails, for example because the wallet is empty, the owner is told and Jay gets an error alert.

## Good to know

- Couriers are for naira businesses only. Shipbubble is Nigerian.
- **Weights.** Prices assume 0.5 kg per item, and a medium box. Change the weight per item with `SHIPBUBBLE_ITEM_KG`. Couriers may charge more if a parcel is much heavier than declared.
- **Late requests.** Prices asked for after 6pm (Lagos time) are for collection the next day.
- **Category.** Shipbubble's first package category is used unless `SHIPBUBBLE_CATEGORY_ID` is set.

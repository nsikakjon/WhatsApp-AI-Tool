# Product photos and stock levels

For businesses that sell from stock (shops, boutiques, bakeries), the quote
bot can show product photos and keep count of what's left. It's on Pro and
above (`catalogue` in `quote_plan_features`, see [QUOTE_PLANS.md](QUOTE_PLANS.md)).

## What the owner does on WhatsApp

- **Photos**: send a picture with the caption `photo T-shirts` (the product's
  name as it is on the price list). Customers get the photo with their quote,
  up to three photos per quote.
- **Stock**: send `stock` to see the price list numbered, with what's left.
  - `stock 3 25`: item 3 has 25 left.
  - `stock 3 off`: stop counting item 3 (made to order, like printing).
  - `stock shirt`: only the items with "shirt" in the name.

Items start as "not counted", so nothing changes until the owner sets a number.
When an item is counted, the bot won't quote more than is left ("only 5
left", or "sold out"), and each confirmed order takes its quantity off.
Saving a new price list on the setup screen keeps the photos and stock.

## Switching it on

1. In Supabase, run `supabase/migrations/0037_quote_catalogue_photos_stock.sql`.
2. On Railway, add `QUOTE_CATALOGUE=true`.

## Demo shop photos

`supabase/seed/demo_quote_photos.sql` gives the yarnOga Demo Shop real
product photos from Pexels (free licence; the credits are in the file), so
people trying the demo get pictures with their quote. Run it after the demo
shop seed and migration 0037. These photos are web addresses rather than
files in storage; an owner's own photo replaces them as usual.

## Swipe cards

When a customer asks for the catalogue (or "menu", "price list"), the bot
normally sends a card per product: photo, prices, description and an
**Order this** button, five at a time. With swipe cards on, the cards come
as **one message the customer swipes sideways**, up to ten at a time. Each
card shows the product's photo, its name, the lowest price on the price list
("From ₦4,200 each") and the Order this button. The price is worked out from
the price list in code, like every other price.

Swipe cards are only used when every product on the price list has a photo
and there are at least two to show. Otherwise, and if WhatsApp ever turns
the swipe message down, the usual cards go out instead, so customers always
see something. No Meta catalogue or Commerce Manager setup is needed.

To switch it on (after `QUOTE_CATALOGUE` is on):

1. On Railway, add `QUOTE_CAROUSEL=true`.
2. Test it on the Demo Shop line: send "catalogue" from your phone. You
   should get one message you can swipe through. Tap **Order this** on a
   card; the bot should reply as if you had typed "I'd like <product>".
3. If you get the separate cards instead, check the Railway logs for
   "WhatsApp turned down the swipe cards" and send the error to Claude.
   Set `QUOTE_CAROUSEL=false` to switch it off again.

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

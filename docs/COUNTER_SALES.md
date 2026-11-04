# Counter sales and profit

For shops where some customers walk in and pay at the counter. Staff ring up
the sale in the owner app, the stock goes down, and the owner sees real profit
per sale and per product.

## What staff do

1. Open **Counter sale** in the app (or the button on the dashboard).
2. Tap **+** next to what the shopper is buying. The search box narrows a long
   list.
3. Pick how they paid: **Cash**, **Transfer** or **POS**.
4. **Check the total**: the app shows each item, its price and the total to
   collect. **Change** goes back; **Confirm sale** records it and takes the
   items off the stock.

Prices come from the price list, worked out the same way as the bot's quotes
(bulk prices and minimums included). The AI is never involved. If a price
changes between checking and confirming, the app shows the new total before
recording anything. Pressing Confirm twice records the sale once, and two
phones can't both sell the last tin: the second is told how many are left.

Internet not steady? The offline till (docs/OFFLINE_TILL.md) does the same
with no connection and sends the sales when it's back.

Who can do what:

- **Owner and manager**: ring up sales, see today's takings split by cash,
  transfer and POS, see profit, and **Cancel** a sale rung up by mistake (its
  items go back on the stock).
- **Cashier**: ring up sales and see today's list with each sale's total. No
  takings, no profit, no cancelling (they ask a manager, as in most shops).
- **Rider**: no access.

## Cost prices and profit

With the switch on, each option on the price list gets a **Cost each** box:
what one piece costs the business to buy or make. Owners and managers see it;
cashiers don't.

- Each sale keeps the cost price it had when sold, so changing a cost later
  doesn't rewrite last month's profit. WhatsApp orders do the same from the
  moment they're quoted.
- **Profit this month** on the dashboard adds up counter sales and paid
  WhatsApp orders: what was taken, minus discounts, minus cost. A sale with any
  item that has no cost price is left out, and the card says how many were.
- **Profit by product this month** lists the five products that made the
  most, with how many were sold and the margin.
- Counter sales are shown on their own card and are **not** added to "Paid in
  this month", which stays WhatsApp orders only.

## Switching it on

1. Supabase > SQL Editor > New query: paste all of
   `supabase/migrations/0060_quote_counter_sales.sql` and press Run. It's safe
   to run twice.
2. Railway > Variables: add `QUOTE_COUNTER_SALES` = `true`.
3. Open the price list and fill in **Cost each** for your products.

It works for every quote business at once. Stock only goes down for items
whose stock is counted (QUOTE_CATALOGUE); the rest are still recorded.

## Scanning barcodes

With `QUOTE_BARCODES` on as well, staff can scan products instead of finding
them in the list.

- **Add the barcodes once.** On the price list, each option gets a
  **Barcode** box. Type the numbers printed under the bars, or tap **Scan**
  next to the box and point the phone camera at the product. Each barcode can
  be on one option only; the app says if it's already on another product.
- **Scan at the counter.** On Counter sale, tap **Scan** and point the camera
  at each item. Every scan adds one, and the camera stays open for the next
  item. The same barcode is taken once every 2 seconds, so holding a tin in
  front of the camera doesn't add five. For several of the same item, scan one
  and tap **+** for the rest.
- **Plug-in scanners work too.** A USB or Bluetooth barcode scanner types the
  code into the search box and presses Enter, and the item is added.

The price still comes from the price list: a barcode only says which item it
is. A code that isn't on the list, or an item that's sold out, shows a note
and adds nothing. Codes printed as UPC (12 digits) and EAN (13 digits) match
either way.

Android phones read barcodes with Chrome's built-in reader. iPhones and other
browsers download a small scanner (about 100 KB, once a week) the first time
someone taps Scan. The page asks for camera permission the first time.

To switch it on:

1. Supabase > SQL Editor > New query: paste all of
   `supabase/migrations/0067_quote_barcodes.sql` and press Run. It's safe to
   run twice.
2. Railway > Variables: add `QUOTE_BARCODES` = `true` (counter sales must be
   on too).
3. Add barcodes on the price list.

# The offline till

For shops (supermarkets especially) whose internet drops during the day. The
till is the counter sale screen as an app on the shop's computer or phone. It
keeps a copy of the price list on the device, so staff keep ringing up sales
with no internet. Each sale is saved on the device and sent to yarnOga as soon
as the connection is back.

It is part of the owner app, not a separate download: the same login, the same
price list, the same staff roles.

## Switching it on

1. Run `supabase/migrations/0070_quote_counter_offline.sql` in Supabase
   (SQL Editor > New query > paste > Run). It needs 0060 (counter sales) first.
2. In Railway, set `OWNER_APP_OFFLINE=true`. Counter sales must be on too
   (`QUOTE_COUNTER_SALES=true`); barcodes (`QUOTE_BARCODES`) work on the till
   when they're on.

The Counter sale page then shows a link to the till, at
`app.yarnoga.com/home/till`.

## Setting up a till (once per device, with internet)

1. Log in to the owner app on the device, then open **Counter sale** and tap
   the **till** link.
2. Install it:
   - **Computer (Chrome or Edge)** or **Android phone**: tap **Install the till
     on this device** at the bottom of the till (or the install icon in the
     address bar). It gets its own icon and opens in its own window.
   - **iPhone**: tap Share, then **Add to Home Screen**.
3. Leave it open for a few seconds so it keeps a copy of the price list.

From then on the till opens even with no internet.

## Using it

The same steps as the Counter sale page: tap **+** (or scan), pick how the
customer paid, **Check the total**, **Confirm sale**. The line at the top says
whether the till is online, and how many sales are waiting to be sent.
**Sales on this till today** lists each sale as *waiting* or *sent*.

## What needs internet, and what doesn't

Works offline: ringing up sales, searching, scanning barcodes (camera or a
plug-in scanner), the till's own list of today's sales.

Needs internet: sending the sales, today's totals and profit for the whole
shop, the dashboard, stock counts from other tills, WhatsApp replies, pay
links, and every other page of the app. These catch up once the till's sales
are sent.

## The tricky cases, and what happens

**The same sale sent twice** (the connection dropped halfway): each sale gets
its own key on the till, so it is recorded once.

**Two tills sell the last items while both are offline.** A sale made offline
has already happened (the customer paid and left with the goods), so it is
always recorded. The stock goes to 0, not below, and the sale is marked on the
Counter sale page: *"sold 2 more than the stock showed. Count the shelf and fix
the stock."* The till itself never blocks a sale because of its stock count:
the shelf is the truth. It shows *"none left on the count"* as a warning.

**The price list changed while a till was offline.** The till charges its last
copy of the price list (those prices came from your price list, never the AI).
The sale keeps the price the customer actually paid, so the cash in the drawer
matches. If your price list says something different when the sale arrives,
the sale is marked: *"charged ₦500 each; the price list says ₦550."* The till
picks up new prices the next time it has internet.

**An item removed from the price list while offline**: the sale is still
recorded under the item's name.

**The till's clock is wrong**: a sale timed in the future is recorded at the
time it arrives.

**A sale sent while a different business is logged in on the device**: it
waits until someone from its own business logs in on that device.

**Logged out** (logins last 30 days): the till keeps working and keeps the
sales. It says so at the top; log in again with internet and the sales go.

## Good to know

- Offline sales land on the day they were made, so the sales, profit and tax
  figures for that day include them once sent. A sale sent days later can
  change a past day's totals.
- The sales wait in the browser's storage on that device. Clearing the
  browser's data (or "site data") before they are sent deletes them. The till
  warns if a sale can't be saved there.
- A sale marked **not sent** was refused (for example, an item that isn't on
  the price list). It is not in your figures. Ring it up again if needed, then
  **Remove** it.
- Cancelling an offline sale puts back only what it took off the stock.

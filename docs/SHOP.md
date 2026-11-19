# Shop link

Every quote-bot business gets a public shop page, shared as a short link
like `https://yarnoga.com/s/mama-put` (the page itself lives at
`https://app.yarnoga.com/shop/mama-put`). Owners put it in their Instagram bio,
on their WhatsApp status or on flyers. It works as the business's one-page
website: products and prices first, then everything else a customer wants to
know before ordering.

What customers see:

- **A notice across the top**, when the owner writes one: "Free delivery in
  Lekki this week" or "Use XMAS for 20% off".
- **The shop's own look**: its logo, a cover photo and its own colour on
  buttons and highlights (set by the owner, see below), and "Open now · closes
  18:00" or "Closed · opens tomorrow at 08:00" from the opening hours in the
  app's Settings.
- **What the shop does**, under its name, from "What you do" in Settings.
- **Trust**: the average star rating once at least 3 customers have rated
  their orders (hidden if the owner switched ratings off), and "Delivers to
  Ikeja, Yaba, Surulere and 2 more areas" from the delivery zones. Tapping
  either jumps to its section further down.
- Four buttons: **Chat on WhatsApp**, **Directions** (opens the customer's
  map app on the shop's address), **Share** (the phone's share sheet, or
  WhatsApp with the link typed) and **Save our number** (adds the shop to the
  customer's contacts, so they find it again).
- A **search box** and **tabs** that stay at the top while scrolling: one per
  category, then About, Reviews, Delivery and Visit.
- A **Popular** badge on up to three products: the ones in the most orders
  over the last 90 days, each in at least 3. It comes from real orders, so a
  new shop shows none until it has sold a few. With two or more, they also
  appear first as **Customers' favourites**, a row to swipe through.
- A **frosted-glass look**: soft glows of the shop's colour behind the page,
  and see-through panels for the header (which sits over the cover photo),
  the cards, the tabs and the order bar.
- The products, with each option's price, bulk price and minimum, worked out
  from the price list exactly the way a quote is. Prices never come from the AI.
- Product photos, on plans that include photos (Pro and above, same as the
  product cards in the chat). Tapping a product opens it full screen, where
  customers swipe through its photos. The phone's back button closes it, and
  the address (`.../shop/mama-put#p-...`) can be shared to open that product.
  A product with several photos can also be swiped right on its card, with
  "2/3" keeping count.
- "Ready in N working days", "N left" when stock is low, and "Sold out" when
  it's gone.
- **Sales**: a product on sale shows "20% off until 30 Nov", its sale price,
  and the old price crossed out. The bot's quotes use the same sale price,
  so the page and the quote always agree.
- **Tell me when it's back** on a sold-out option. It opens WhatsApp with
  "Please tell me when Flyers: A4 is back in stock (ref 1a2b3c4d)" typed. The
  bot notes it, and when the option has stock again (or stops being counted)
  it messages that customer once, within five minutes. Waits over 60 days old
  are dropped.
- **Share** on each product's full-screen view: the phone's share sheet, or
  WhatsApp with that product's own link typed (`.../s/mama-put#p-...`).
- **+ and - buttons** beside each option. The first + jumps to the option's
  minimum, and + stops at the stock that's left. A bar at the bottom shows a
  running total "before delivery", worked out from the price list's prices
  (bulk and sale prices included). **Buy now on WhatsApp** opens a chat with
  the business's number and the order already typed, ending in an order code:

  ```
  Hello Ada's Prints, I'd like to buy now:
  • 20 x Branded T-shirts: white, one-colour print
  • 6 x Branded mugs: white ceramic, 11oz

  Order code: SHOP 1a2b3c4d*20 5e6f7a8b*6
  ```

  The code names each option and quantity, so the bot reads it in code (no
  AI, no AI reply used up) and confirms the order straight away, without
  waiting for YES: the customer gets the invoice with the total, delivery
  (asked for first, as usual) and the pay link. Prices are looked up from the
  price list at that moment, never taken from the message. If something
  can't be taken as asked (below a minimum, not enough stock, priced by the
  team), the bot sends a normal quote and waits for YES instead. Nothing is
  paid or saved on the page itself.
- Each product also has its own **Order on WhatsApp** button, for customers
  who'd rather just ask.
- Below the products, each section showing only when the shop has something
  for it:
  - **Good to know**: the owner's "What customers often ask" text from
    Settings (the same text the bot answers from).
  - **What customers say**: "90% said Great", with how many customers tapped
    Great, OK and Not good when the bot asked after their orders. Same rule as
    the stars: 3 ratings or more, and not when ratings are switched off.
  - **Delivery**: every delivery area with its fee, from the Delivery page.
    Fees come from the database, like every other amount on the page.
  - **Visit us**: the week's opening hours with today marked, and the address
    with a Directions button.
  - **Follow us**: the shop's Instagram, TikTok, Facebook, X and YouTube pages.
  - **Get our offers on WhatsApp**: a button that sends JOIN, which puts the
    customer on the business's broadcast list (they can send STOP any time).
    Shown only when broadcasts are on.
- Small movements: a dot flies into the bar when something is added, the
  product view slides up, and the rating bars fill as they come into view. Phones set to "reduce motion" get none of it.

When the link is shared on WhatsApp, Instagram or Facebook, the preview shows
a picture made from the cover photo (or the first product photo) with the
logo on it, or the logo and name on the shop's colour when there are no photos.

The page is built for slow connections: no add-on libraries, the page itself
is about 9 KB, and photos are shrunk on the server to the size the phone
shows them (a product photo is around 10 to 30 KB), loading only as the
customer scrolls to them.

It's on every plan, Free included: it's how customers find the bot.

## For the owner

- Send **shop** to the bot: it replies with the link, making it from the
  business name the first time (`Ada's Prints` becomes `adas-prints`).
- Send **shop link mama-put** to change the name in the link. The old link
  stops working. Names are 3 to 40 lowercase letters, numbers or dashes, and
  each one can only belong to one business.
- In the app, the **QR posters** page shows the link at the top, and the owner
  can change the name there too.
- Also on the **QR posters** page, under **How your shop looks**: pick a
  colour (or keep yarnOga's) and upload a cover photo. Changes show within
  10 minutes.
- Under **Where customers find you**, on the same page: the shop's address
  (for Directions) and its social media pages. For each page the owner types
  the name (`@adasprints`) or pastes the page's link. Without an address
  there, "Visit us" shows the address from Settings (the one on invoices),
  with no Directions button.
- Nothing else needs typing twice: "What you do", "What customers often ask"
  and opening hours come from **Settings**, delivery areas from **Delivery**.
- On the **Price list** page, each product can have up to 4 **more photos**
  besides its main one; customers swipe through them on the shop page.
- Also on a product's page in **Price list**, under **Sale**: a discount (1 to
  90%) and the sale's last day. Every option's price drops by that much until
  the end of that day (Lagos time), then goes back by itself. Leave both empty
  to stop a sale early. A new product gets the Sale boxes once it's saved.
- On the **QR posters** page, under **Notice at the top**: one line (up to
  120 letters) for the top of the shop. Empty takes it off.
- The shop stays closed until the business's WhatsApp number (the one
  customers message) is saved in the app's **Settings**. The "shop" reply
  says so when it's missing.

## Switching it on

1. Run `supabase/migrations/0059_quote_shop_links.sql` in Supabase (SQL
   Editor > New query > paste > Run). It needs 0020 and 0049 to be run first.
2. On Railway, add `QUOTE_SHOP=true`. `PUBLIC_URL` must already be set (it is,
   for payments).
3. For the colour, cover and extra photos, run
   `supabase/migrations/0061_quote_shop_look.sql` too (after 0060). Until
   then the shop works as before, in yarnOga's colours.
4. For the address, Directions and social media pages, run
   `supabase/migrations/0081_quote_shop_page.sql` too. The other new sections
   need nothing run.
5. For the notice, sales and "Tell me when it's back", run
   `supabase/migrations/0094_shop_extras.sql` too (after 0081). Before or
   after this version goes live is fine: until it's run, the owner app hides
   the new boxes and the shop works as before.
6. Optional: to tell customers who haven't messaged in the last day that an
   item is back, make a **Utility** template in WhatsApp Manager and put its
   name in `BACK_IN_STOCK_TEMPLATE_NAME` on Railway (language in
   `BACK_IN_STOCK_TEMPLATE_LANGUAGE`, default `en`). Suggested words:
   "Good news from {{1}}: {{2}} is back in stock. Reply with how many you'd
   like and we'll send your quote." Without it, those customers are told the
   next time they message, if the item still has stock.
7. Make sure each business has its WhatsApp number in Settings. For the Demo
   Shop that's `2347048971600`.

The page is cached for a minute, so price list changes show within a minute.

## Short links

Shop links are shared as `yarnoga.com/s/<name>`: in the "shop" reply, the
owner app, Share and Save our number on the page, invoices and emails. The
website (on Hostinger) forwards anything under `/s/` to the shop page in the
app, so the short link and the long one open the same page and old long links
keep working.

1. On Hostinger, open **Websites > yarnoga.com > File Manager**, go into
   `public_html` and turn on hidden files (Settings > Show hidden files).
2. If there's a file called `.htaccess`, open it. If not, create a new file
   with that name. Paste these lines at the very top (above any WordPress or
   LiteSpeed block, whose catch-all rule would otherwise answer first with a
   404) and save:

   ```
   # Short shop links: yarnoga.com/s/mama-put opens that shop's page.
   RewriteEngine On
   RewriteRule ^s/([A-Za-z0-9-]+)/?$ https://app.yarnoga.com/shop/$1 [R=301,L]
   ```

3. Open `https://yarnoga.com/s/<a real shop name>` on your phone. It should
   land on that shop's page.
4. Only then, on Railway, add `SHOP_LINK_BASE=https://yarnoga.com/s`. From the
   next deploy every link the app gives out uses the short form.

`app.yarnoga.com/s/<name>` works too: the app sends it on to the same page.
Shop names live under `/s/`, so they can never clash with a page on the website.

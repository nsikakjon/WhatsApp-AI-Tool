# Shop link

Every quote-bot business gets a public shop page, for example
`https://app.yarnoga.com/shop/mama-put`. Owners put it in their Instagram bio,
on their WhatsApp status or on flyers.

What customers see:

- **The shop's own look**: its logo, a cover photo and its own colour on
  buttons and highlights (set by the owner, see below), and "Open now · closes
  18:00" or "Closed · opens tomorrow at 08:00" from the opening hours in the
  app's Settings.
- **Trust**: the average star rating once at least 3 customers have rated
  their orders (hidden if the owner switched ratings off), and "Delivers to
  Ikeja, Yaba, Surulere and 2 more areas" from the delivery zones.
- A **search box** and **category tabs** that stay at the top while scrolling.
- The products, with each option's price, bulk price and minimum, worked out
  from the price list exactly the way a quote is. Prices never come from the AI.
- Product photos, on plans that include photos (Pro and above, same as the
  product cards in the chat). Tapping a product opens it full screen, where
  customers swipe through its photos. The phone's back button closes it, and
  the address (`.../shop/mama-put#p-...`) can be shared to open that product.
- "Ready in N working days", "N left" when stock is low, and "Sold out" when
  it's gone.
- **+ and - buttons** beside each option. The first + jumps to the option's
  minimum, and + stops at the stock that's left. A bar at the bottom shows a
  running total "before delivery", worked out from the price list's prices
  (bulk prices included). **Send order on WhatsApp** opens a chat with the
  business's number and the order already typed, e.g.

  ```
  Hello Ada's Prints, I'd like to order:
  • 20 x Branded T-shirts: white, one-colour print
  • 6 x Branded mugs: white ceramic, 11oz
  ```

  The bot then replies with a normal quote (exact total, delivery, discounts).
  Nothing is paid or saved on the page itself.
- Each product also has its own **Order on WhatsApp** button, and the header
  has **Chat on WhatsApp**, for customers who'd rather just ask.
- Small movements: a dot flies into the bar when something is added, and the
  product view slides up. Phones set to "reduce motion" get none of it.

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
- On the **Price list** page, each product can have up to 4 **more photos**
  besides its main one; customers swipe through them on the shop page.
- The shop stays closed until the business's WhatsApp number (the one
  customers message) is saved in the app's **Settings**. The "shop" reply
  says so when it's missing.

## Switching it on

1. Run `supabase/migrations/0059_quote_shop_links.sql` in Supabase (SQL
   Editor > New query > paste > Run). It needs 0020 and 0049 to be run first.
2. On Railway, add `QUOTE_SHOP=true`. `PUBLIC_URL` must already be set (it is,
   for payments).
3. For the colour, cover and extra photos, run
   `supabase/migrations/0060_quote_shop_look.sql` too (after 0059). Until
   then the shop works as before, in yarnOga's colours.
4. Make sure each business has its WhatsApp number in Settings. For the Demo
   Shop that's `2347048971600`.

The page is cached for a minute, so price list changes show within a minute.

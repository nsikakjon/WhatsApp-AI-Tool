# Shop link

Every quote-bot business gets a public shop page, for example
`https://app.yarnoga.com/shop/mama-put`. Owners put it in their Instagram bio,
on their WhatsApp status or on flyers.

What customers see:

- The business's products, grouped by category if the owner uses categories,
  with each option's price, bulk price and minimum, worked out from the price
  list exactly the way a quote is. Prices never come from the AI.
- Product photos, on plans that include photos (Pro and above, same as the
  product cards in the chat).
- "Ready in N working days" when the product has a production time, "N left"
  when stock is low, and "Sold out" (no quantity box) when it's gone.
- A quantity box beside each option. Once they pick something, a bar appears
  at the bottom: **Send order on WhatsApp** opens a chat with the business's
  number and the order already typed, e.g.

  ```
  Hello Ada's Prints, I'd like to order:
  • 20 x Branded T-shirts: white, one-colour print
  • 6 x Branded mugs: white ceramic, 11oz
  ```

  The bot then replies with a normal quote (exact total, delivery, discounts).
  Nothing is paid or saved on the page itself.
- Each product also has its own **Order on WhatsApp** button, and the header
  has **Chat on WhatsApp**, for customers who'd rather just ask.

It's on every plan, Free included: it's how customers find the bot.

## For the owner

- Send **shop** to the bot: it replies with the link, making it from the
  business name the first time (`Ada's Prints` becomes `adas-prints`).
- Send **shop link mama-put** to change the name in the link. The old link
  stops working. Names are 3 to 40 lowercase letters, numbers or dashes, and
  each one can only belong to one business.
- In the app, the **QR posters** page shows the link at the top, and the owner
  can change the name there too.
- The shop stays closed until the business's WhatsApp number (the one
  customers message) is saved in the app's **Settings**. The "shop" reply
  says so when it's missing.

## Switching it on

1. Run `supabase/migrations/0059_quote_shop_links.sql` in Supabase (SQL
   Editor > New query > paste > Run). It needs 0020 and 0049 to be run first.
2. On Railway, add `QUOTE_SHOP=true`. `PUBLIC_URL` must already be set (it is,
   for payments).
3. Make sure each business has its WhatsApp number in Settings. For the Demo
   Shop that's `2347048971600`.

The page is cached for a minute, so price list changes show within a minute.

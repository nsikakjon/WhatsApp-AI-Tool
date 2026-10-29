# Order board and sales dashboard

Each business owner on the quote bot can open a private page with their
orders and sales. They send **orders** to the bot on WhatsApp and get a link.

- **Sales**: quotes sent, orders, quote-to-order rate, money paid in and AI
  replies used, this month next to last month.
- **Order board**: every confirmed order from the last 60 days in five
  columns: New, Paid, In production, Out for delivery, Delivered.
  - New and Paid follow the order: it moves to Paid when the owner sends
    `paid KP-1001`.
  - The owner presses **Start production** or **Delivered** on the page.
  - Out for delivery and Delivered follow the rider when delivery is on
    (see [DELIVERY.md](DELIVERY.md)).
  - Delivered orders stay for 7 days.

Both are on Pro and above (`order_board` and `sales_dashboard` in
`quote_plan_features`, see [QUOTE_PLANS.md](QUOTE_PLANS.md)). A business with
no plan, like KahnPrints, gets both.

## Switching it on

1. In Supabase, run `supabase/migrations/0036_quote_order_board.sql`.
2. On Railway, add `QUOTE_ORDER_BOARD=true` and `PUBLIC_URL`
   (`https://app.yarnoga.com`; you already have it if delivery or payments are
   on).
3. From the owner's WhatsApp, send **orders** to the bot.

The link is signed with the WhatsApp app secret, so nobody can guess another
business's page. Anyone the owner forwards it to can see the orders, so the
bot tells them to keep it to themselves. Changing the app secret changes every
link; owners then send **orders** again for a new one.

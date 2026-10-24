# Walk-in orders: restaurants, bars and events

For customers who are already there: a restaurant table, a bar, a stand at an
event. They order and pay in the WhatsApp chat, the kitchen or bar sees the
order on a screen, and the receipt carries a QR code that staff scan when the
customer collects. Each order can only be handed over once.

## What the customer sees

1. They scan a poster (or a table card) that opens the business's WhatsApp
   chat with "I'm here" already typed (a table card: "Table 7", so staff know
   where to bring the order). That checks them in for 12 hours. Customers can
   also just type it. Poster link: `https://wa.me/<number>?text=I'm%20here`.
2. They order as usual ("2 Desperados and a jollof"), get a quote and reply YES.
   The bot doesn't ask about delivery.
3. They pay with the Paystack link (card, transfer or USSD), or at the counter.
4. Their receipt has a QR code and a short code like `EH-214 · 4827`, and says
   where to collect (Bar, Kitchen).
5. When staff tap Ready, they get "Your order EH-214 is ready at the Bar".
   With a table, the message says it's on its way to the table instead.

## Businesses that also deliver, and branches

Walk-in orders never get in the way of delivery:

- **A business with delivery switched on** keeps delivering. Only customers
  who checked in ("I'm here" or a table) are treated as walk-in. Someone
  ordering from home gets the usual delivery questions, even while an event
  is running. **close orders** only stops orders at the venue.
- **A business without delivery** treats every chat as walk-in, so a
  restaurant or a stand needs no check-in step.
- **Branches**: each branch has its own WhatsApp number, its own walk-in
  switch and its own screens. For an event at one branch, that branch's owner
  number sends **walk-in on** (and **walk-in off** after); the other branches
  carry on as normal. The main business's order board still shows every
  branch's orders. A branch counts towards the main business's plan, so the
  plan needs walk-in and enough screens.
- **A one-off event away from your branches**: add it as a branch with its
  own number for the night, so its posters, screens and closing time are its
  own.

## What staff see

The owner sends **screens** to the bot and gets a link for each pickup screen.
Open it on a phone or tablet at that spot (keep it on charge, screen on).

- **Making**: paid orders for this screen. Tap **Ready** when it's done.
- **Ready**: waiting for the customer. Tap **Collected**, or scan their QR code.
- **Collected**: what went out in the last 20 minutes.
- **Waiting for payment**: orders not paid yet. When the customer pays cash or
  POS at the counter, tap **Paid at counter**: they get their receipt with the
  QR code, and the order goes to the screens.

To hand an order over, tap **Scan QR** and point the camera at the customer's
receipt, or type the order number and code (`214 4827`). The page shows what
to hand over with a **Hand over** button. If it was already collected, it says
so in red with the time. Don't hand it over again.

The screens refresh themselves every few seconds. Anyone with a screen link can
hand orders over, so keep links to staff. Each screen has its own link.

## Bar, kitchen and other screens

By default everything goes to one **Counter** screen. To split drinks and food:

- **stations**: lists the products, numbered, with the screen each goes to.
- **station 1 Bar**: product 1 goes to the Bar screen.
- **station 4 Kitchen**: product 4 goes to the Kitchen screen.
- **station 4 off**: back to the Counter.

An order with drinks and food makes a Bar ticket and a Kitchen ticket. Each is
readied and collected on its own, and the receipt says "Collect at: Bar,
Kitchen". The owner's **screens** reply then has a link for each, plus an
"Every order" screen for a manager.

## Owner commands

- **walk-in on** / **walk-in off**
- **close orders** / **open orders**: stop new orders (last orders, sold out
  night) without switching walk-in off. Paid orders stay on the screens.
- **stations**, **station 3 Bar**, **screens** (above)
- **walk-in** on its own shows whether it's on and these commands.

Sold-out items: use **stock 3 0** (photos and stock, docs/CATALOGUE.md).

## Plans

| Plan       | Walk-in orders | Pickup screens |
| ---------- | -------------- | -------------- |
| Free       | no             |                |
| Starter    | yes            | 1              |
| Pro        | yes            | up to 3        |
| Growth     | yes            | up to 10       |
| Enterprise | yes            | no limit       |

These live in `quote_plan_features` (rows `walk_in` and `stations`, migration
0047) and can be changed there without touching code.

## yarnOga's fee

Every payment made through a pay link carries yarnOga's fee, 2.5% (migration
0048). Paystack keeps it back for us when it splits the payment, so the
customer pays the menu price and the business gets the rest straight into its
bank account, less Paystack's own fee. Payments taken at the counter (cash,
POS, transfer to the business) never pass through us and carry no fee.
See docs/PAY_LINKS.md.

## Switching it on

1. **Supabase**: run `supabase/migrations/0047_quote_walk_in.sql`, and
   `0048_quote_transaction_fee.sql` when you're ready to charge the fee.
2. **Railway**: set `QUOTE_WALK_IN=true`. `PUBLIC_URL` must already be the
   server's https address (it is, for pay links and the order board).
3. The business owner sends **walk-in on** to their bot, then **screens**.

For payments by link, the business also needs a Paystack subaccount
(docs/PAY_LINKS.md). Without one, customers pay at the counter and staff tap
**Paid at counter**.

## Things to plan for at a busy venue

- **Phone signal**: a packed hall can lose mobile data. Give guests Wi-Fi near
  the bars if you can, and give the screens a steady connection. A receipt
  already on a customer's phone still works without signal, since staff scan
  it from the screen. Staff can type the code if a camera won't focus.
- **Payment speed**: card payments confirm in seconds; some bank transfers take
  longer. The receipt (and the QR code) only arrives once Paystack confirms, so
  never hand over on a screenshot of a transfer.
- **Drinking age**: the bot can't check age. Check ID at the door or at
  collection.
- **Refunds**: if something runs out after it's paid, offer a swap or refund
  from the Paystack dashboard.

# Payments (Paystack)

Customers pay by card, bank transfer or USSD on a Paystack checkout page. The
bot sends the link on WhatsApp, and whatever was bought switches on by itself
as soon as Paystack confirms the money arrived.

Today this is used for flyer plan upgrades (`upgrade standard`,
`upgrade premium 3 months`, `upgrade deluxe 1 year`) and quote bot plan
upgrades (the business owner sends `upgrade starter` for a month or
`upgrade starter yearly` for a year; needs migration
`0033_quote_plan_payments.sql`). A paid quote plan lasts until a date, then the
business is back on the free plan until it pays again. Quote invoices can
also carry a pay link that pays the store's own bank account (docs/PAY_LINKS.md).
Any other product can use the same code in `src/core/payments`.

Until `PAYSTACK_SECRET_KEY` is set, nothing is charged: `upgrade` messages go to
the owners, who take payment by hand as before.

## How it works

1. An admin sends `upgrade standard 3 months`. The bot looks the price up in
   the database (never from the AI), saves a **pending** payment with a
   reference like `yarnoga-flyer-…`, and replies with a Paystack link. A full
   year uses the "paid yearly" price.
2. The admin pays on Paystack's page.
3. Paystack calls our webhook, `/webhooks/paystack`. We check the
   `x-paystack-signature` header (proof the call really came from Paystack),
   then ask Paystack ourselves whether that payment succeeded, in naira, for
   at least the full amount.
4. The payment is marked **paid**, once. If Paystack sends the same event
   again, nothing happens a second time.
5. The group moves onto the plan, and the admin and the owners get a WhatsApp
   message.

After paying, the admin's browser lands on `/payments/done`, which runs the
same check, so the plan still switches on if the webhook is slow.

## Setting it up

Do this with the **test** keys first. Nothing real is charged in test mode.

1. **Supabase**: run `supabase/migrations/0032_payments.sql` (SQL Editor >
   New query > paste > Run).
2. **Railway** (your service > Variables). Never paste these keys into a chat,
   email or document; Railway is the only place they go.
   - `PAYSTACK_SECRET_KEY`: Paystack dashboard > Settings > API Keys &
     Webhooks > **Test Secret Key** (starts `sk_test_`).
   - `PUBLIC_URL`: this server's address, `https://app.yarnoga.com` (see
     docs/CUSTOM_DOMAIN.md).
   - `PAYSTACK_CUSTOMER_EMAIL`: an inbox you read, e.g.
     `payments@yarnoga.com`. Paystack requires an email for every payment.
     When the payer gave us their own email for receipts (chat sign-up,
     /signup or owner app Settings, with emails switched on), it goes on the
     payment and Paystack's receipt reaches them. Otherwise this one is used
     and the receipt comes here. Each payment carries the payer's WhatsApp
     number in the Paystack dashboard.
3. **Paystack dashboard** > Settings > API Keys & Webhooks: set **Test Webhook
   URL** to `PUBLIC_URL` followed by `/webhooks/paystack`. Leave the callback
   URL empty; the bot sends its own with every payment.
4. After Railway redeploys, the log line `Server listening …` ends with
   `payments: Paystack test`.

### Trying it

Send `upgrade standard` to the flyer number from a test group, open the link
and pay with Paystack's test card: `4084 0840 8408 4081`, any future expiry
date, CVV `408` (PIN `0000` and OTP `123456` if asked). The bot should reply on WhatsApp that the payment was
received, and `plan` should show Standard.

### Going live

When you're happy with the test:

1. Replace `PAYSTACK_SECRET_KEY` in Railway with the **Live Secret Key**
   (starts `sk_live_`).
2. In Paystack, set the **Live Webhook URL** to the same address as the test one.
3. The log line now says `payments: Paystack live`.

## If something goes wrong

- **Paid, but the plan didn't switch on**: Paystack retries its webhook for a
  while, and the plan switches on with the next try. You can always switch it
  on by hand: `set plan standard 3 months for <group>`. Paystack's dashboard
  shows the payer's WhatsApp number under each payment.
- **The bot says "We'll message you shortly with how to pay"** instead of
  sending a link: Paystack was down or refused the request (the Railway logs
  say why), or the plan's price is "on request". The owners get the request on
  WhatsApp, as before.
- **Webhook rejected (401 in the logs)**: the secret key in Railway isn't from
  the same Paystack mode (test or live) as the webhook URL you set.

## Paying for a plan outside Nigeria

People outside Nigeria can pay for a quote bot or flyer plan in their own
currency, at fixed prices (not the day's exchange rate). The bot goes by the
payer's WhatsApp number:

| Number from | Pays in | Through |
|---|---|---|
| Nigeria (+234) | Naira | Paystack |
| Ghana (+233) | Cedis | Flutterwave: Mobile Money or card |
| Kenya (+254) | Shillings | Flutterwave: M-Pesa or card |
| CFA franc countries (Senegal, Côte d'Ivoire, Cameroon...) | CFA francs | Flutterwave: Mobile Money or card |
| Anywhere else | US dollars | Paystack: card |

The prices are in the `plan_prices` table (migration
`0062_plan_prices.sql`), the same ones as the website's currency picker. To
change one, change it in the table and in the website's `js/currency.js`.

To switch it on:

1. Run `0062_plan_prices.sql` in Supabase.
2. **US dollars:** in the Paystack dashboard, go to Settings > Preferences and
   ask for international payments (USD). Paystack checks the business, then
   asks for a USD (domiciliary) account at Zenith Bank to pay dollars into.
3. **Cedis, shillings and CFA francs:** switch Flutterwave on (next section).
4. In Railway, set `PLAN_CURRENCIES` to the currencies that are ready, e.g.
   `GHS,KES` once Flutterwave works, then add `XOF,XAF` and `USD` as each one
   is ready. Any currency not listed is charged in naira, so it is safe to add
   them one at a time.

The `plan` reply still lists prices in naira; the payment link and its
message show the amount in the payer's currency.

## Switching on Flutterwave

Flutterwave is off until its secret key is in Railway. With it off, nothing
changes: everyone pays in naira through Paystack.

1. In the Flutterwave dashboard, open **Settings > API Keys**. The bot uses
   the **v3 keys** (Public key, Secret key, Encryption key). If the page shows
   a Client ID and Client Secret instead, use the switch on that page to show
   the v3 keys. Start in **Test mode**.
2. In Railway > Variables, add:
   - `FLUTTERWAVE_SECRET_KEY`: the **Secret key** (starts with
     `FLWSECK_TEST-` in test mode, `FLWSECK-` when live). Paste it only into
     Railway, never into a chat or a document.
   - `FLUTTERWAVE_SECRET_HASH`: a long phrase you make up, at least 16
     characters (for example four random words and a number).
3. In Flutterwave, open **Settings > Webhooks**:
   - URL: your `PUBLIC_URL` followed by `/webhooks/flutterwave`;
   - Secret hash: the same phrase as `FLUTTERWAVE_SECRET_HASH`;
   - if the page offers event or format choices, keep successful payments
     (charge) ticked and JSON format on. Save.
4. Make sure Flutterwave has **GHS** and **KES** collections on for the
   account (Settings > Business preferences, or ask support). Cedi links fail
   with "currency not supported" until it does.
5. In Railway, set `PLAN_CURRENCIES` to `GHS,KES`. Railway redeploys in about
   two minutes; the "Server listening" line in the deploy log then says
   "Flutterwave test".
6. Test from a Ghana (+233) or Kenya (+254) number that owns a test shop:
   send *upgrade starter* to the quotes number. The link should
   open a Flutterwave page in cedis or shillings. Pay with Flutterwave's
   test card. The bot confirms on WhatsApp and the plan switches on.
7. Once that works, repeat steps 1 to 3 in **Live mode** (the live secret key
   replaces the test one; set the secret hash on the live webhook too).

Shop pay links through Flutterwave work the same way for CFA franc shops: each
shop gets a Flutterwave subaccount (RS_...) with its Mobile Money or bank
account, and `QUOTE_PAY_LINKS` stays `true`. See docs/FRENCH.md.

If a Flutterwave link fails, the bot tells the payer it will send payment
details shortly, and the Railway logs say what Flutterwave answered.

## For developers

`src/core/payments` knows nothing about any product:

- `payments.createLink({ product, waId, amountKobo, purpose, title, currency })`
  saves a pending payment and returns the checkout link: Paystack for naira and
  US dollars, Flutterwave for CFA francs, cedis and shillings. The product looks
  the amount up in the database first; `plan-prices.ts` finds a plan's price in
  the payer's currency.
- Each product registers an `onPaid` handler in `src/index.ts`
  (`paidHandlers.<product>`), which gets the saved payment, including its
  `purpose`, and returns the WhatsApp messages to send. It runs once per
  payment; if it throws, the payment goes back to pending so a retry can run
  it again.
- Promo and referral codes (DAYONES, `QUOTE_REFERRALS`) are in `docs/PROMO_CODES.md`.

# Payments (Paystack)

Customers pay by card, bank transfer or USSD on a Paystack checkout page. The
bot sends the link on WhatsApp, and whatever was bought switches on by itself
as soon as Paystack confirms the money arrived.

Today this is used for flyer plan upgrades (`upgrade standard`,
`upgrade premium 3 months`, `upgrade deluxe 1 year`). Any other product can use
the same code in `src/core/payments`.

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
   - `PUBLIC_URL`: this server's address, e.g.
     `https://your-app.up.railway.app` (Railway > Settings > Networking).
   - `PAYSTACK_CUSTOMER_EMAIL`: an inbox you read, e.g.
     `payments@yarnoga.com`. Paystack requires an email for every payment and
     WhatsApp doesn't give us the customer's, so receipts go here. Each
     payment carries the payer's WhatsApp number in the Paystack dashboard.
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

## For developers

`src/core/payments` knows nothing about any product:

- `payments.createLink({ product, waId, amountKobo, purpose, title })` saves a
  pending payment and returns the Paystack link. The product looks the amount
  up in the database first.
- Each product registers an `onPaid` handler in `src/index.ts`
  (`paidHandlers.<product>`), which gets the saved payment, including its
  `purpose`, and returns the WhatsApp messages to send. It runs once per
  payment; if it throws, the payment goes back to pending so a retry can run
  it again.

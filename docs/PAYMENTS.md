# Online payments with Flutterwave

When this is switched on, a flyer group admin who sends `upgrade standard`
gets a Flutterwave payment link in WhatsApp. They pay by card, bank transfer
or USSD, and the group moves onto the plan by itself within seconds. You get
a WhatsApp message for every payment. Nobody has to send `set plan` any more
(you still can, e.g. for someone who paid you by bank transfer directly).

If it's switched off, or Flutterwave is having a bad day, the bot falls back
to the old way: you get an "upgrade request" message and handle it by hand.

## How it stays safe

- **Prices come from the database.** The amount on the link is the plan's
  price in `flyer_plans` times the number of months. The AI is never involved.
- **Money is in kobo.** ₦3,000 is stored as `300000`.
- **Nobody can fake a payment.** Flutterwave sends every payment notice with a
  secret password (the "secret hash") only you and Flutterwave know; notices
  without it are thrown away. Even then, the server asks Flutterwave directly
  whether the payment really went through, in naira, for the full amount.
- **A payment counts once.** Each payment link has its own reference in the
  `payments` table. If Flutterwave sends the same notice twice, or the payer
  refreshes the "thank you" page, the plan is only extended once.

## 1. Create the payments table (Supabase)

Supabase > **SQL Editor** > **New query**, paste all of
`supabase/migrations/0009_payments.sql`, click **Run**. You should see
"Success. No rows returned" and a new `payments` table in the Table Editor.

## 2. Get your Flutterwave keys

1. Sign up at <https://flutterwave.com> (or sign in) with your business email.
2. You start in **Test mode** (a switch at the top of the dashboard). Test mode
   uses pretend money, so you can try everything before going live. To take
   real payments, Flutterwave needs your business documents (the dashboard
   walks you through it: BVN, ID, and CAC registration if you have it) and
   your bank account for payouts. Start that now, since approval can take a
   few days, but you don't need to wait for it to test.
3. Go to **Settings > API Keys**. Copy the **Secret Key**. In test mode it
   starts with `FLWSECK_TEST-`; the live one starts with `FLWSECK-`. If the
   page offers v3 and v4 keys, use **v3**. Never share the secret key or put
   it anywhere except Railway.

## 3. Add the settings (Railway)

Railway > your service > **Variables**, add:

| Variable                     | Value                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| `FLUTTERWAVE_SECRET_KEY`     | the secret key from step 2 (start with the test one)                    |
| `FLUTTERWAVE_WEBHOOK_HASH`   | a long password you make up, e.g. from a password manager (save it, you'll type it into Flutterwave next) |
| `PUBLIC_URL`                 | your Railway address, e.g. `https://whatsapp-platform-production.up.railway.app` (Railway > Settings > Networking), no `/` at the end |
| `FLUTTERWAVE_CUSTOMER_EMAIL` | your business email. Flutterwave insists on an email for each payment and WhatsApp doesn't give us customers' emails, so receipts come to you |

Railway redeploys by itself. In **Deployments > View logs** you should see
`payments: Flutterwave` at the end of the "Server listening" line.

## 4. Tell Flutterwave where to send payment notices (the webhook)

Flutterwave dashboard > **Settings > Webhooks**:

- **URL**: your `PUBLIC_URL` followed by `/webhooks/flutterwave`, e.g.
  `https://whatsapp-platform-production.up.railway.app/webhooks/flutterwave`
- **Secret hash**: exactly the same value as `FLUTTERWAVE_WEBHOOK_HASH`.
- Tick **Enable webhook retries** (so a notice that arrives while the server
  is restarting is sent again) and **Receive webhook response in JSON format**
  if they're offered.
- Click **Save**.

Test mode and live mode have separate webhook settings, so do this again
after switching to live.

## 5. Try it

1. On WhatsApp, from a group admin's number, send the flyer bot
   `upgrade standard`. You should get the price and a link.
2. Open the link and pay with one of Flutterwave's **test cards** (listed on
   Flutterwave's developer site under "Testing"; search "Flutterwave test cards").
3. You land on a "Payment received" page, and on WhatsApp the admin gets
   "✅ Payment of ₦3,000 received" and you get a "💰 Paid" message.
4. Send `plan`: the group should be on Standard for a month.
5. In Supabase > `payments`, the row says `paid`.

## 6. Go live

Once Flutterwave has approved your business: switch the dashboard to **Live
mode**, copy the live secret key into `FLUTTERWAVE_SECRET_KEY` on Railway, and
set up the webhook again (step 4) in live mode with the same secret hash.

## What admins can send

- `upgrade standard`: a link for one month.
- `upgrade premium 3 months` or `upgrade standard 1 year`: up to 12 months at
  once. Paying again before the plan ends adds the time on top.
- `renew`: a link for the plan they're already on.
- Plans with no price in `flyer_plans` (Organisation: "price on request") still
  go to you by hand.

## Switching it off

Delete `FLUTTERWAVE_SECRET_KEY` on Railway. Upgrades go back to being handled
by hand. Nothing else changes.

## If something doesn't work

- **No link, the bot says "we'll message you shortly"**: payments are off, the
  plan has no price, or Flutterwave refused. Railway logs show
  `Couldn't make a payment link` with Flutterwave's reason (a wrong secret key
  is the usual one).
- **Paid, but the plan didn't change**: check the Railway logs for
  `Flutterwave webhook`. `Rejected ... wrong verif-hash` means the secret hash
  in Flutterwave and `FLUTTERWAVE_WEBHOOK_HASH` don't match exactly. No log
  line at all means the webhook URL in Flutterwave is wrong.
- **The server won't start** after adding the key: the log names the missing
  variable (all four in step 3 are needed together).

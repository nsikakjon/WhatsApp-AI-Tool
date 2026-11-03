# Paying riders and staff (Pay people)

Owners and managers can pay riders for deliveries and staff their wages from
the owner app (**Pay people** in the menu). The money lands in the person's
bank account through Paystack Transfers.

## How it works

- **The payout balance.** A shop's sales go straight to its own bank (pay
  links use Paystack subaccounts), so yarnOga's Paystack balance never holds
  the shop's money. To pay people, the shop first adds money: **Add** on the
  Pay people page opens a Paystack checkout. Paystack keeps its usual charge
  (1.5%, at most ₦2,000), and the rest goes on the shop's payout balance.
  The owner gets a WhatsApp message saying how much was added.
- **Delivery pay owed.** Orders a rider delivered in the last 30 days that
  haven't been paid from here. The amount starts at the delivery fee the
  customer paid; the owner changes it to the rider's share. A delivery can
  only be paid once.
- **Riders and staff.** Riders come from Riders & delivery, staff from
  Settings > Team. Each person needs bank details first. Only the **owner**
  can add or change them, and the account name is checked with the bank
  before it's saved, so a manager can't swap in their own account.
- **Two steps to send.** Pay first shows a confirm screen with the person, the
  bank account and account name, the amount, Paystack's transfer fee and the
  balance after. Nothing moves until **Yes, send**. The confirm screen expires
  after 10 minutes, and tapping it twice doesn't pay twice.
- **Fees.** Paystack's transfer fee (₦10 up to ₦5,000, ₦25 up to ₦50,000,
  ₦50 above) comes off the payout balance with each payment. The fees are in
  the `payout_transfer_fees` table; change them there if Paystack does.
- **If a payment fails** or the bank reverses it, the money goes back on the
  balance automatically. If Paystack doesn't answer clearly, the money stays
  held and the payment shows **Check again**.
- The person paid gets a WhatsApp message from the business's number when the
  money is sent (if they've chatted with the number in the last 24 hours).

Who can use it: owner and manager. Cashiers and riders don't see the page.
Naira businesses only.

## Switching it on (jay)

1. **Turn on Transfers in Paystack.** Paystack dashboard > Settings >
   Preferences > Transfers. If Paystack asks for more business documents to
   allow transfers, send them. Paystack may ask what the balance is for: it's
   money shops add to pay their own riders and staff.
2. **Turn off the transfer OTP** on the same page ("Confirm transfers before
   sending" / OTP). With it on, every transfer waits for a code sent to you,
   and the app can't send it. Paystack may ask you to confirm by OTP once
   when you turn it off.
3. **Run migration `0066_payouts.sql`** in Supabase (SQL Editor > New query >
   paste > Run). Running it again is safe.
4. **On Railway**, add `QUOTE_PAYOUTS=true`. It needs `PAYSTACK_SECRET_KEY`
   and `PUBLIC_URL`, which are already set.
5. The Paystack webhook URL stays the same (`<PUBLIC_URL>/webhooks/paystack`);
   transfer results arrive there too.

## Trying it

Use the Demo Shop with a small amount: add ₦1,000, add your own bank details
as a test rider or staff member, pay ₦100, and check it lands.

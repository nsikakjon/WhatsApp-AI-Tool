# Pay links on quote invoices

When a customer confirms an order, the invoice comes with a Paystack link
(card, bank transfer or USSD). Once Paystack confirms the payment, the order is
marked paid, the customer gets their receipt and the owner gets a message. The
owner no longer has to send `paid KP-1001` for these orders.

## Whose money, whose account

The customer pays through yarnOga's Paystack account, but the money goes
**straight to the business's own bank account**. Paystack calls this a
subaccount: one per business, holding only its bank name and account number.

- yarnOga never holds a store's money, so we're not collecting and paying out
  other people's sales.
- A store doesn't need its own Paystack account, and nobody shares secret keys.
- Paystack's fee (1.5% + ₦100, at most ₦2,000 a payment) comes out of the
  store's share. If yarnOga ever takes a cut, it's set per subaccount in
  Paystack ("Percentage charge"); no code changes.
- Refunds and disputes go through yarnOga's Paystack account, so only add a
  subaccount for businesses we've onboarded.

A business without a subaccount works exactly as before: bank details on the
invoice and the owner sends `paid KP-1001`.

## Customers who pay by transfer

- **Through the pay link**: Paystack's page has "Pay with Transfer" (a one-off
  account number). That's confirmed automatically like a card payment.
- **Straight to the bank details on the invoice**: nothing changes. The owner
  checks their bank and sends `paid KP-1001`.

## Switching it on

Needs Paystack set up already (docs/PAYMENTS.md). Try it in test mode first:
subaccounts made with test keys only work in test mode, so make each one again
in live mode.

1. **Supabase**: run `supabase/migrations/0045_quote_pay_links.sql`.
2. **Paystack dashboard > Subaccounts > Create subaccount**, for each business:
   its name, bank and account number (Paystack shows the account name so you
   can check it), and **Percentage charge 0**. Copy the code it gives, e.g.
   `ACCT_8f4s1eq7ml6rlzj`. If there's no Subaccounts menu, ask Paystack
   support to turn on split payments.
3. **Setup screen** (`/quote-setup`): open the business and paste the code
   into **Paystack subaccount**. For the main number, set
   `QUOTE_PAYSTACK_SUBACCOUNT` on Railway instead.
4. **Railway**: set `QUOTE_PAY_LINKS=true`.

The subaccount code isn't a secret (it only says where money goes), but the
Paystack secret key still only ever goes in Railway.

## Trying it

Ask the business's number for a quote, reply YES, and the invoice picture's
caption has the link. Pay with the test card `4084 0840 8408 4081` (any future
date, CVV `408`, PIN `0000`, OTP `123456`). Within seconds the customer gets
"Payment received" with the receipt, the owner gets "💰 KP-1001 paid online",
and the order board shows it paid. In Paystack, the payment shows the
subaccount it was split to.

## If something goes wrong

- **No link on the invoice**: the business has no subaccount, `QUOTE_PAY_LINKS`
  isn't `true`, or Paystack refused (the Railway log says `Couldn't make a pay
  link` with the reason; a test subaccount used with the live key is the usual
  one). The customer still has the bank details.
- **Paid twice** (online and by transfer): the order is only marked paid once,
  and the owner is told so a refund can be made from yarnOga's Paystack.

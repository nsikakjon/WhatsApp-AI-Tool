# Monthly payments from regular customers

For businesses whose customers pay the same amount every month: gym members,
dance or lesson classes, a monthly water or gas supply. The owner sets it up
once in the owner app (**Monthly payments** in the menu) and the bot collects
each month on the business's own WhatsApp number.

## How it works

- **Plans.** The owner adds what they charge monthly, e.g. "Gym membership
  ₦15,000". Prices are typed in the app and saved in the database, never
  made up by the AI. A changed price applies from the next month due.
- **Customers.** The owner adds each customer with their WhatsApp number, the
  plan and the date of the first payment. They then pay on that day of the
  month (a customer who starts on the 31st pays on the last day of shorter
  months).
- **The first payment.** If it's due today, a Paystack link is made straight
  away. WhatsApp only lets the bot message someone who wrote to the number in
  the last 24 hours, so the customer's page in the app has a **Send on
  WhatsApp** button that opens the owner's own WhatsApp with the link typed.
- **Card or link.** When a customer pays by card, Paystack lets us charge the
  same card again, so from then on it's charged on the pay day without a
  link. The customer is told this when they pay. Customers who pay by
  transfer or USSD get a fresh link each month. If a saved card is declined,
  a link goes instead.
- **Reminders.** 3 days and 7 days after the pay day if it's still unpaid.
  At 7 days the owner is told too, so they can follow up or cancel. Messages
  only go between 8am and 8pm.
- **When the bot can't message the customer** (no chat in the last day), the
  owner gets the link on WhatsApp to forward. With an approved template (see
  below), the customer gets it directly instead.
- **Paid.** The customer gets a receipt with the next due date and the owner
  gets a "💰 paid" message. A month is only charged and counted once, however
  often Paystack sends its webhook.
- **Stopping.** The owner taps **Cancel monthly payments** on the customer's
  page, or **Stop using their card** to go back to links. A customer who
  wants to stop tells the business in the chat.

Owners and managers see the page; cashiers and riders don't.

## Whose money

The same as invoice pay links (docs/PAY_LINKS.md): the money goes to the
business's own bank through its Paystack subaccount, Paystack's fee comes off
the business's share, and yarnOga's transaction fee from the business's plan
(2.5%, capped) stays with yarnOga. Only naira businesses with a Paystack
subaccount get the page.

## Switching it on (jay)

1. **Supabase**: run `supabase/migrations/0067_quote_monthly_payments.sql`
   (SQL Editor > New query > paste > Run). Running it again is safe.
2. **Railway**: add `QUOTE_MONTHLY_PAYMENTS=true`. It needs
   `PAYSTACK_SECRET_KEY` and `PUBLIC_URL`, which are already set, and a
   Paystack subaccount on each business that will use it.
3. Optional, so customers get their link even when they haven't chatted
   lately: in WhatsApp Manager, create a **Utility** template, e.g. named
   `monthly_payment_due`, with this body:

   > Hi {{1}}, your {{3}} for {{4}} at {{2}} is due. Pay here: {{5}}

   Once Meta approves it, add `QUOTE_MONTHLY_TEMPLATE_NAME=monthly_payment_due`
   on Railway (and `QUOTE_MONTHLY_TEMPLATE_LANGUAGE` if it isn't English, `en`).
   Each template message is charged by Meta.

The Paystack webhook stays the same; monthly payments arrive there too.

## Trying it

On the Demo Shop with Paystack test keys: add a plan for ₦100, add yourself
as a customer due today, open the link from the customer's page and pay with
the test card `4084 0840 8408 4081` (any future date, CVV `408`, PIN `0000`,
OTP `123456`). You should get the receipt and the owner's "💰" message, and
the customer's page shows the card as saved with next month's date.

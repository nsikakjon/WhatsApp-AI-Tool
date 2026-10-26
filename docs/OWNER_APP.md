# The owners' and staff app (app.yarnoga.com)

One web app where each business on the quote bot runs everything: it works
on a phone first, and on a laptop with a menu down the side.

| Page | What it does | Who |
| --- | --- | --- |
| Dashboard | money paid in, orders, quotes and conversion this month against last; customers who messaged; orders waiting for payment or to make; low stock; orders per day (14 days); AI replies and bot messages used against the plan; best sellers | everyone |
| Inbox | the business's own chats: read, reply as a person, take a chat over from the bot and hand it back | everyone |
| Orders | the order board (New, Paid, In production, Out for delivery, Delivered), search, **Mark paid** (sends the receipt), Start production, Delivered | everyone |
| Price list | products with photo, name, description, category, "sold per" unit, production time, and options, each with a minimum order, stock and up to three quantity prices | everyone |
| Riders & delivery | delivery zones (areas and fee) and riders | everyone sees; the owner changes |
| Test your bot | ask what a customer would ask and see the real reply, with nothing sent or saved (60 a day) | everyone |
| QR posters | branded posters with a QR code that opens a WhatsApp chat, portrait and landscape, English or French, as a PDF to print or a picture | everyone |
| Export | orders as a CSV file, a Google Sheets link that keeps itself up to date, and a monthly PDF sales report | owner |
| Settings | business details and logo, bank accounts (with the transaction fee note), alert numbers, team, password | owner |
| Help | how it works, a getting-started checklist, WhatsApp commands, questions, support contacts | everyone |
| Status | whether the database, WhatsApp and the AI are working | everyone |

Prices still only ever come from the price list (worked out in code from
kobo); the AI never sets a price. Money is typed in naira and saved in kobo.

## Logging in

- **From WhatsApp (no password needed):** the owner or a staff member sends
  **app** to the business's WhatsApp number from their own phone. The bot
  replies with a link that works once, for 15 minutes.
- **With a password:** once set in Settings > Your password, log in at
  `/app/login` with the WhatsApp number and password.
- The owner is whoever's number is the business's owner number. Staff are
  added in Settings > Team.
- Guessing is slowed down: after 5 wrong passwords from one address, or for one
  number, logins wait 15 minutes (and every wrong password waits a moment).
- Logins last 30 days. Setting a password, or **Log out everywhere else**,
  logs out every other browser. Removing a staff member logs them out at once.

## Switching it on

1. **Supabase**: SQL Editor > New query > paste all of
   `supabase/migrations/0049_owner_app.sql` > Run.
2. **Railway** > your service > Variables:
   - `OWNER_APP=true`
   - `PUBLIC_URL` (you have it already if payments or delivery are on)
   - `OWNER_APP_URL=https://app.yarnoga.com` (after step 3; until then leave
     it empty and the links use the Railway address)
   - optionally `SUPPORT_WA_ID` (yarnOga's support WhatsApp number)
3. **app.yarnoga.com**:
   - Railway > your service > Settings > Networking > **Custom Domain** >
     type `app.yarnoga.com`. Railway shows a CNAME value.
   - Hostinger > Domains > yarnoga.com > **DNS / Nameservers** > add a
     **CNAME** record: name `app`, target the value Railway showed.
   - Wait for Railway to show the domain as active (minutes to a few hours).
     `https://app.yarnoga.com` then opens the app.
4. From the owner's WhatsApp, send **app** to the bot and tap the link.

## Things that come from elsewhere

- **The main number's business (KahnPrints)** has its name, address and
  owner number in Railway variables, so the app shows them but can't change
  them. Its bank accounts, alert numbers, team, logo and price list work as
  normal.
- **Product photos** need `QUOTE_CATALOGUE` on; without it the photo box is
  hidden.
- **Riders & delivery** needs `QUOTE_DELIVERY` on.
- **Bank account check**: with Paystack on, the owner picks their bank from
  Paystack's list and the account name is filled in from the bank, so a typo
  can't send customers' money elsewhere. Without Paystack they type it.
- The account marked "On invoices" becomes the bank details printed on
  invoices. Pay links still pay into the Paystack subaccount yarnOga sets up
  (docs/PAY_LINKS.md); the app doesn't create subaccounts.
- **Extra alert numbers** get a copy of every message the bot sends the owner
  (new orders, payments, customers asking for a person). Each one should send
  **hi** to the business number once, since WhatsApp only delivers to people
  who've written in the last day.
- **Google Sheets link**: anyone with the link can read the orders, so the
  owner can make a new one (Export > Make a new link), which turns the old one
  off.

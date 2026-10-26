# Customer care features

Seven features that bring in money and save owners time. None of them needs a new paid service.

Messages to customers only go inside WhatsApp's free 24-hour window, which starts each time the customer last messaged. If that window has closed, the message is skipped rather than sent as a paid template.

## What each one does

1. **Payment reminders.** When a customer confirms an order but doesn't pay, they get **at most two** friendly reminders:
   - about 3 hours after confirming;
   - about 20 hours after confirming.

   Each reminder has a fresh pay link (or the bank details). Reminders only go out between 8am and 8pm. They never go to someone who said STOP, or while staff have taken over the chat. Each reminder is recorded before sending, so it can never go twice.

2. **About your business.** In the app, under **Settings > About your business**, the owner writes what customers often ask: where the shop is, delivery days, returns, how long orders take. The owner also sets opening hours.
   - The bot answers questions only from what the owner wrote, and still never gives prices.
   - Outside opening hours, the welcome, "Talk to someone" and order confirmations say the shop is closed and when it opens again.

3. **Morning summary.** At 8am the owner gets yesterday's figures on WhatsApp:
   - orders and money paid in;
   - the best seller and ratings;
   - orders still waiting for payment;
   - items running low.

   Nothing is sent on a day with nothing to report. Its **Got it** button keeps WhatsApp's free window open, so the next morning's summary arrives too.

4. **Ratings.** Once per paid order, the customer is asked "How did we do?" with three buttons: Great / OK / Not good.
   - **When:** a few hours after payment, or 30 minutes after delivery.
   - **Not good:** alerts the owner straight away.
   - **Where to see them:** the average shows on the dashboard, in the morning summary and on the Customers page.

5. **Order again.** When a returning customer says hi, they see what they ordered last time and an **Order again** button. Tapping it sends a fresh quote for the same items at today's prices. Anything no longer sold is left out, and the bot says so.

6. **Customers page.** In the app, the **Customers** page lists everyone who ordered in the last year:
   - how many orders, what they paid, and their last order;
   - their rating, with a link to the chat;
   - biggest spenders first, with search.

   Owners can download the list as a spreadsheet.

7. **Low-stock alerts.** When an order takes an item down to 5 or fewer, or sells it out, the owner's new-order message says so. It says so once, at the moment the item crosses that line.

## What Jay needs to do

1. **Run the migration.** In Supabase, go to SQL Editor > New query, paste `supabase/migrations/0054_customer_care.sql`, and click Run (after 0053).
2. **Switch features on in Railway:**
   - `QUOTE_PAY_REMINDERS=true` for payment reminders;
   - `QUOTE_RATINGS=true` for ratings.

   The morning summary, About, Order again, Customers and low-stock alerts need nothing more. The morning summary needs the owner app (`OWNER_APP`), which is already on.
3. **Tell owners.** Each owner can switch reminders, ratings and the morning summary off under **Settings > Messages the bot sends for you**. Ask them to fill in **About your business** and their opening hours.

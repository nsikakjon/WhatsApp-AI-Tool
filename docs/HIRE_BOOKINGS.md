# Hire bookings

For any business that hires things out by the day: generators and building
equipment, cars, event chairs, canopies and sound systems, halls, costumes.
Customers ask on WhatsApp, the bot checks what is free on their dates, quotes
the hire and a refundable deposit, and the dates are booked once they pay.
Nothing gets double booked.

Comes with Pro, Growth and Enterprise (plan feature `hire_bookings`).

## Switching it on

1. Run `supabase/migrations/0097_quote_rentals.sql` in Supabase.
2. On Railway, add `QUOTE_RENTALS` = `true` (it needs `PUBLIC_URL`, which is
   already set).
3. Optional, recommended: in WhatsApp Manager make a **Utility** template, for
   example named `hire_update`, with this body:

   > Hello from {{1}}. An update on your hire booking {{2}} ({{3}}): {{4}} Reply to this message if you have any questions.

   Once Meta approves it, add `RENTAL_UPDATE_TEMPLATE_NAME` = `hire_update` on
   Railway. Without it, reminders only reach customers who messaged in the
   last 24 hours, which most hire customers won't have.
4. Optional, for the demo number: run `supabase/seed/demo_hire_items.sql` to
   give the yarnOga Demo Shop a generator, canopies, chairs, a sound system and
   concrete mixers to try.

## Setting up a hire business (owner, on WhatsApp)

1. Add each item to the price list as usual. **Its price is the daily rate.**
2. Send **hire** to see the price list with numbers.
3. **hire 3 on** makes item 3 a hire item (1 owned, no deposit).
4. **hire 3 units 2 deposit 50000 week 120000** says they own 2, the deposit
   for one is ₦50,000 and 7 days cost ₦120,000. Any of the three can be sent
   alone. **week off** removes the weekly rate; **hire 3 off** stops hiring it
   out.

Don't count stock ("stock" command) on hire items: the number owned does that
job, day by day.

## What the customer sees

"Do you have a 20kVA generator for 3 days from Friday?" gets a quote like:

> • 1 x Generator: 20kVA hire, Fri 27 Nov to Mon 30 Nov (3 days) @ ₦75,000 = ₦75,000
> • 1 x Refundable deposit: Generator: 20kVA @ ₦50,000 = ₦50,000
>
> Out Fri 27 Nov, back Mon 30 Nov. Free on those dates.

- Dates are read in code, not by the AI: "from Friday for 3 days", "27 Nov to
  30 Nov", "27th-30th", "tomorrow for a week", "this weekend". It goes out on
  the first date and comes back on the second, so 27 to 30 Nov is 3 days.
- Missing dates or a missing length get a short question.
- Full weeks are charged at the weekly rate and the days left over at the
  daily rate, but never more than another week.
- If not enough are free, the bot says how many are, quotes those, and says
  when the full number is free next.
- After YES, delivery is asked as for any order. The invoice and pay link cover
  hire, deposit and delivery together.
- YES holds the dates for 24 hours while they pay; payment books them. If two
  customers say YES to the last one at the same moment, the database lets only
  one through and the other is asked for different dates.

## Day to day (owner)

- **bookings**: what is going out today, due back, overdue and out on hire.
  The same summary arrives every morning at 7am, with yesterday's money in and
  the deposits being held.
- **free 27 Nov to 30 Nov**: how many of each hire item are free.
- **out DEMO-1012**: it has left (delivered or collected).
- **back DEMO-1012**: it is back and fine. With damage:
  **back DEMO-1012 damage 15000 broken handle**. A voice note saying the same
  works. Late days (at the booking's daily rate) and damage come off the
  deposit. The customer gets the breakdown; the owner is told what to refund,
  or, when the deposit doesn't cover it, the customer gets a pay link for the
  difference.
- **agreement DEMO-1012**, **checklist DEMO-1012**: the hire agreement to sign
  and the delivery and return checklist, as A4 PDFs to print.
- **stickers**: a QR sticker for each hire item. Scanning it opens WhatsApp
  with "I'd like to hire the Generator: 20kVA" typed in. KahnPrints can print
  them on sticker paper.

## Reminders to customers

Daytime only (8am to 8pm Lagos):
- the day before it goes out,
- the day before it is due back,
- once, the day after it was due back if it hasn't come back.

## Not covered yet

- Extending a hire from the chat: the customer replies and the owner sorts it
  (for now, a new booking for the extra days).
- Part-day or hourly hire, and different rates for weekends.
- The agreement's terms are general ones. Each business should check them, and
  have a lawyer look at them before relying on them.

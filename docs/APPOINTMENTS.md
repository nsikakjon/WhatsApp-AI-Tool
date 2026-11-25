# Appointment booking: gyms, clinics, salons and coaches

Customers book a time on WhatsApp by tapping through short lists, pay to
hold it (or book free and pay at the visit), and get reminders. Nobody can
book a time that's already taken. It comes with Pro, Growth and Enterprise.

Examples: a clinic with two doctors, a physio, a gym with personal trainers
and spin classes, a salon, a tutor or coach, a consultant.

## What the customer sees

1. They send **book** (or "I want to book a session", "appointment"), or ask
   about a bookable service in their own words and the AI picks it.
2. A list of the services that can be booked, with the length and the price
   from the price list.
3. For one-to-one sessions with more than one person: who they'd like to see,
   or **First free**.
4. The days with free times (up to 10), then the times that day. A group
   class shows how many places are left.
5. Then, depending on the service:
   - **Pay in full** or **deposit**: the time is held for 30 minutes and they
     get a pay link. Paying books it. If they don't pay, the hold is let go
     (and its unpaid order cancelled) so someone else can have the time.
   - **Pay at the visit**: booked straight away.
6. A reminder the day before (in the daytime) and 2 hours before, with
   **Change time** and **Cancel** buttons while it's still allowed.
7. **my bookings** lists their upcoming bookings to change or cancel. After
   the owner's cut-off (12 hours by default) they're asked to message the
   business instead.

Each booking has a number like **B1042**.

## What the owner does

Everything is on WhatsApp. Send **booking** to see the setup and the commands.

1. Add the services to the price list as usual (prices always come from the
   price list, never from the AI). Send **booking** to see their numbers.
2. Make them bookable:
   - `book 3 60min`: row 3 is a 60-minute one-to-one session.
   - `book 4 45min class 20`: row 4 is a group class with 20 places.
   - `book 3 deposit 5000`: take a ₦5,000 deposit to book; the rest is paid at the visit.
   - `book 3 pay later`: book free, pay at the visit. `book 3 pay full`: pay the full price to book (the default).
   - `book 3 off`: stop taking bookings for it.
3. Calendars are the people (or rooms) customers book. The first service you
   make bookable creates one named after the business, open Mon-Sat 9-5.
   - `calendar add Dr Ada`, then `calendar 2 Mon-Fri 9-5`, `calendar 2 Sat 10-2`, `calendar 2 Sun off`.
   - `calendar 2 does 3 4`: Dr Ada only does rows 3 and 4 (`does all` to undo).
   - `calendar 2 remove`.
4. Group class times: `class 4 Mon Wed Fri 7am`, add `with 2` for who takes
   it (they then can't be booked one-to-one at that time). `class 4 clear` to start again.
5. Days off: `block Sat`, `block 25 Dec`, `block 27 Nov 9-12`, `block Fri 2-4 for 2` (one person).
6. Rules: `booking rules notice 2 days 14 cancel 12` (at least 2 hours'
   notice, up to 14 days ahead, cancel or change up to 12 hours before).

Day to day:

- `bookings` (today), `bookings tomorrow`, `bookings Sat`.
- A list of the day's bookings comes at 7am.
- `done B1042`, `no-show B1042` after a visit.
- `cancel B1042` and `move B1042 to Sat 10am`: the customer is told.
- New bookings, cancellations and changes come to the owner as alerts.

Gym members on a monthly fee: use Monthly payments (docs/MONTHLY_PAYMENTS.md)
for the fee, and make the classes **pay later** so members book free.

## Switching it on

1. Run `supabase/migrations/0099_quote_appointments.sql` in Supabase.
2. In Railway, add `QUOTE_APPOINTMENTS` = `true`.
3. Optional: an approved **Utility** template for reminders, so they reach
   customers who haven't messaged in the last 24 hours. Without it, reminders
   only go to customers who wrote in the last day. Suggested body:

   > Reminder from {{1}}: your {{2}} is booked for {{3}} (booking {{4}}). Reply here to change or cancel it.

   Then add `APPOINTMENT_REMINDER_TEMPLATE_NAME` (and
   `APPOINTMENT_REMINDER_TEMPLATE_LANGUAGE` if it isn't `en`).

## Good to know

- Times are Lagos time, like the rest of the bot.
- Booking replies are in English for now.
- A booking paid after its hold ran out is still booked; if someone else took
  the time meanwhile, the owner is told so they can move one of them.

# Event tickets: sell on WhatsApp, check in at the door

A business can sell tickets to its event in the WhatsApp chat. Each ticket
paid for arrives as its own picture with a QR code, and the door screen lets
each one in once. It works for parties, concerts, church and alumni events,
classes and anything with a guest list.

## What the customer sees

1. They message the business ("2 VIP tickets for Saturday") and get a quote
   from the price list, then reply YES.
2. A tickets-only order doesn't ask about delivery. They pay with the pay
   link (or the business's bank details).
3. Once paid, they get one picture per ticket: the event, the ticket type, a
   big QR code and a short code like `EH-214 · 4827`. They forward one to each
   friend: every QR code lets one person in.
4. Lost them? They send **my tickets** and get the unused ones again.

## What the owner does

1. Add the tickets to the price list like any product, one row per ticket
   type, with the event in the name: `Element House 15 Nov: Regular` ₦10,000,
   `Element House 15 Nov: VIP` ₦50,000. Prices always come from the price
   list, never from the AI.
2. Send **tickets** to the bot. It lists your products with numbers. Send
   **ticket 3 on** for each ticket type (**ticket 3 off** to stop selling it
   as a ticket; tickets already sold still get in).
3. To cap how many sell, set the ticket's stock with the **stock** command
   (needs QUOTE_CATALOGUE). Stock comes off when a customer confirms, and
   once it runs out the bot tells customers that ticket is sold out.
4. Send **door** for the door screen link. Open it on the phone at the door.
   Keep the link to your door staff.
5. **tickets** also shows how many of each ticket are sold and let in.

Payments work as for any order: by pay link (the shop's own Paystack
subaccount, with yarnOga's usual fee), "paid EH-214" from the owner, or the
owner app.

## At the door

- Tap **Scan QR** and point the camera at the guest's ticket. A green
  **Let them in** means it's good and is now used. A red **Already used at
  9:41pm** means that ticket got in before: don't let them in again.
- If the QR code won't scan (a cracked screen), type the code under it, for
  example `214 4827`, and tap **Check**.
- **Scan next** opens the camera again for the next guest.
- A QR code from another business, or a made-up one, shows "Not a ticket for
  this event".
- If a guest scans their own QR code with a phone camera, it opens a page
  that says whether the ticket is still valid. That doesn't let them in: only
  the door screen does.

## Switching it on

1. In Supabase, run `supabase/migrations/0067_quote_event_tickets.sql` (SQL
   Editor > New query > paste > Run). Running it again is safe.
2. In Railway, set `QUOTE_EVENT_TICKETS=true`. It needs `PUBLIC_URL` (already
   set for pay links).
3. With QUOTE_PLAN_FEATURES on, tickets come with Starter and above (the
   `event_tickets` row in each plan; change it in the plan editor).

## How it's built

- `src/products/quote/tickets/`: the owner commands and ticket making
  (`index.ts`), the ticket picture (`card.ts`), signed links (`links.ts`), the
  database (`store.ts`) and the door pages (`door.ts`).
- Each ticket is a row in `quote_event_tickets` with its own 4-digit code.
  A ticket's QR code holds a signed link, so nobody can make one up.
  Checking in only succeeds while `checked_in_at` is empty, so two phones
  scanning the same ticket at once can't both let it in.
- Tickets are made when the order is marked paid, which happens once per
  order (a repeated Paystack webhook is already skipped), and making them
  again for the same order changes nothing.
- The door screen reuses the walk-in pickup screen's camera scanner.

# Broadcasts: sending offers to customers who opted in

A paid add-on for quote bot businesses. The business owner writes a promo or
price update on WhatsApp, sees a preview, confirms, and the bot sends it to
every customer who asked to receive offers.

It is **off** until you switch it on (step 4), and even then a business can
only broadcast once you give it the add-on (step 5). Until then nothing about
the quote bot changes.

## How it works

**Customers**

- Send **JOIN** to the business's number to get offers. The bot confirms.
- Send **STOP** (or UNSUBSCRIBE, or tap **Stop promotions** under an offer) to
  stop. Before a customer has joined, a plain "stop" goes to the quote bot as
  usual, because they probably mean their quote.
- Opting in is per business: joining Mama Cakes' offers doesn't sign anyone up
  for another business.
- Each yes or no is saved with the time and the WhatsApp message it came in,
  as proof of consent.

**The owner** (the number that gets order alerts)

| Send this                                | What happens                                               |
| ---------------------------------------- | ---------------------------------------------------------- |
| `broadcast`                              | How it works, how many opted in, messages used this month |
| `broadcast 10% off A5 flyers this week!` | Saves a draft and shows a preview, the reach and the cost |
| a photo with that as its caption         | The same, with the photo at the top (step 3)             |
| `send broadcast 7`                       | Sends draft 7                                              |
| `cancel broadcast 7`                     | Stops it; nobody else gets it                              |

Nothing is sent until the owner replies `send broadcast <number>`. Sending it
twice does nothing the second time.

**Sending**

- Messages go out a few a minute (`BROADCASTS_PER_MINUTE`, default 30), so
  WhatsApp's limits aren't hit all at once.
- Each customer gets each broadcast once, even if the server restarts halfway.
- Someone who says STOP after the broadcast was confirmed is skipped.
- When it's finished, the owner gets a message with how many were sent. (If the
  owner hasn't messaged the bot in the last day, WhatsApp may hold that back.)

**The monthly limit**

Each business has a number of broadcast messages a month (Lagos time; resets
on the 1st). One message = one customer. If more people opted in than are left
this month, the preview says so and the oldest sign-ups get it first.

## What it costs

Every broadcast message is a WhatsApp **Marketing** template message, and Meta
bills each one to our WhatsApp account, whether or not the customer has
messaged recently. Check today's Nigeria rate in WhatsApp Manager > Overview
or Meta's pricing page, and price the add-on above it.

If you put the rough rate in `BROADCAST_COST_KOBO` (in kobo, e.g. `7000` for
₦70), the owner's preview shows an estimate of what the broadcast will cost.

## Setting it up

### 1. Run the migration (Supabase)

Supabase > SQL Editor > New query > paste the whole of
`supabase/migrations/0029_broadcasts.sql` > Run. It needs
`0020_quote_businesses.sql` to have been run first.

### 2. Create the Marketing template (Meta)

1. Go to **WhatsApp Manager** > **Message templates** > **Create template**.
2. Category: **Marketing**. Type: **Default** (custom).
3. Name: `business_offer`. Language: **English**.
4. Body:

   ```
   Hello! Here's an update from {{1}}:

   {{2}}

   Reply STOP to stop these messages.
   ```

   Sample values for the review: `{{1}}` = `Mama Cakes`,
   `{{2}}` = `This week only: 10% off all birthday cakes. Message us to order.`
5. Buttons: **Add button** > **Marketing opt-out**, text `Stop promotions`.
   (When a customer taps it, the bot opts them out.)
6. Submit. Approval usually takes minutes to a day.

Meta sometimes rejects a template that is mostly placeholders. If that
happens, add a little more fixed wording around `{{2}}` and submit again.

### 3. Optional: a template with a picture

For broadcasts with a photo (e.g. a new flyer), create a second template the
same way, named `business_offer_image`, with **Header: Image** (upload any
sample picture for the review). The body and button are the same.

### 4. Switch it on (Railway)

Add these Variables:

| Variable                        | Value                                    |
| ------------------------------- | ---------------------------------------- |
| `BROADCASTS_ENABLED`            | `true`                                   |
| `BROADCAST_TEMPLATE_NAME`       | `business_offer`                         |
| `BROADCAST_IMAGE_TEMPLATE_NAME` | `business_offer_image` (or leave empty)  |
| `BROADCAST_TEMPLATE_LANGUAGE`   | `en` (the template's language code)      |
| `BROADCASTS_PER_MINUTE`         | `30` (optional)                          |
| `BROADCAST_COST_KOBO`           | e.g. `7000` (optional, for the estimate) |

### 5. Give a business the add-on (Supabase)

A business can only broadcast with a row in `broadcast_addons`. In the SQL
Editor (business #1 is KahnPrints on the main number; other businesses' ids are
in the `quote_businesses` table):

```sql
insert into public.broadcast_addons (business_id, monthly_limit)
values ('00000000-0000-0000-0000-000000000001', 500)
on conflict (business_id) do update set monthly_limit = excluded.monthly_limit, active = true;
```

To switch it off again: `update public.broadcast_addons set active = false where business_id = '...';`

### 6. Getting customers to opt in

Tell the business to share a link that opens WhatsApp with JOIN already typed:
`https://wa.me/<their number, digits only>?text=JOIN`, e.g. on their status,
flyers, receipts or website. WhatsApp's rules require customers to agree
before they get marketing messages, which is why only people who sent JOIN
are ever messaged.

## Good to know

- WhatsApp may hold back marketing messages to people who already get a lot of
  them (error 131049). Those count as "couldn't be delivered" in the owner's
  summary and aren't retried.
- If a business's quality rating drops (customers blocking or reporting),
  Meta can limit or pause its templates. Keep broadcasts occasional and useful.
- The quote bot's prices never come from a broadcast: a broadcast is the
  owner's own words, and quotes are still priced from the price list.

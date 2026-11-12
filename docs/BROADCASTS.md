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

**Message packs**

After migration 0083, an owner can also buy a pack of messages by Paystack
link, in the Send to your customers box under a flyer in the owner app (naira
shops only). The month's messages are used first, then the pack's, and pack
messages don't run out at the end of the month. A shop with no monthly
messages can broadcast on packs alone.

Packs and prices are rows in `quote_broadcast_packs` (kobo). `billed_by` says
who Meta charges: `yarnoga` packs (100 for ₦15,000, 250 for ₦35,000, 500 for
₦65,000) are for shops on a number in our WhatsApp account, where the price
has to cover Meta's charge; `business` packs (₦25 a message) are for shops
that connected their own WhatsApp account and pay Meta themselves. To change
a price, edit the row; to stop selling a pack, set `active` to false.

## What it costs

Every broadcast message is a WhatsApp **Marketing** template message, and Meta
bills each one to our WhatsApp account, whether or not the customer has
messaged recently. Check today's Nigeria rate in WhatsApp Manager > Overview
or Meta's pricing page, and price the add-on above it.

If you put the rough rate in `BROADCAST_COST_KOBO` (in kobo, e.g. `7000` for
₦70), the owner's preview shows an estimate of what the broadcast will cost.

With `MARKETING_MESSAGES_API=true`, broadcasts go through Meta's Marketing
Messages API once the WhatsApp account has accepted its terms (see
[MARKETING_MESSAGES.md](MARKETING_MESSAGES.md)).

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

With the picture template set, the owner app's Flyers page also gets a **Send to your customers** box on each finished flyer: the owner types a message and the flyer goes to everyone who opted in, counted against the same messages, with message packs to buy when there aren't enough.

**Shops that connect their own number.** Templates belong to one WhatsApp account, so the two above only work from our numbers. With broadcasts on and `META_SIGNUP_CONFIG_ID` set, yarnOga makes both templates (same wording, Marketing, `Stop promotions` button, a sample picture for the picture one) in a shop's own account when it connects, and checks every connected shop once an hour, which also covers shops connected earlier. Meta still has to approve them, which takes minutes to a day: until the picture template is approved in a shop's own account, its owner app hides **Send to your customers**. A template Meta turns down is left alone and logged, because making it again under the same name would be refused. The text-only broadcast typed in WhatsApp (`broadcast ...`) does not wait for approval, so on a shop's own account it can fail until its templates are approved.

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

### 5. Monthly messages (Supabase)

With `QUOTE_PLAN_FEATURES` on, a business gets the broadcasts on its plan
automatically: Pro 50, Growth 200 and Enterprise 1,000 a month after
migration 0084 (the `broadcasts` rows in `quote_plan_features`). Run 0084
before switching broadcasts on. A branch has no plan of its own, so it buys
packs or gets a row as below.

To give one business a different number, add a row in `broadcast_addons`,
which is used instead of the plan's (0 switches its monthly messages off). In the SQL
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

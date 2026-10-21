# Moving everything into the verified Kahn Prints portfolio

The **Kahn Prints** business portfolio is now verified by Meta. This guide puts
all our WhatsApp numbers, the Facebook Page and the Instagram account in that
one portfolio, so they all benefit from verification and one set of keys
works for everything.

Work through the steps in order. Steps 1 to 4 matter now; 5 onwards can wait.

Meta renames buttons often. If a name doesn't match, look for the nearest one.

---

## Where things should sit

A **business portfolio** (what Meta used to call Business Manager) holds
**WhatsApp accounts**, and each WhatsApp account holds one or more **numbers**.

| Number | Used for | WhatsApp account | Status |
| --- | --- | --- | --- |
| +234 811 433 0749 | KahnPrints quote bot (business #1) | "Kahn Prints", ID 1463401605808243 | Live |
| +234 704 385 7494 | yarnOga Flyers | "KahnPrints", ID 2332559297282667 | Live |
| +234 704 897 1600 | yarnOga quotes line: demo shop and sign-up by chat | add to 2332559297282667 | To do (step 4) |
| Site reporter number (not chosen yet) | yarnOga Site Reporter | add to 2332559297282667 | Later (step 9) |

The yarnOga numbers go together in one WhatsApp account, and KahnPrints keeps
its own, because KahnPrints is a client that happens to be ours. If a real
client ever moves away, its account can go with it without touching yarnOga.

Two things are now shared across the whole portfolio, not per number:

- **Messaging limit**: how many different people all our numbers together can
  message first in 24 hours. Replies to people who messaged us don't count.
- **Business verification**: done once, covers every number in the portfolio.

---

## Step 1: Check what is in the portfolio (10 minutes)

1. Go to <https://business.facebook.com/settings> and pick **Kahn Prints** at
   the top left.
2. **Accounts** > **WhatsApp accounts**. Both 1463401605808243 and
   2332559297282667 should be listed. If one is missing, it lives in another
   portfolio: tell Claude before moving anything, because moving a WhatsApp
   account between portfolios is a request to Meta, not a button.
3. **Accounts** > **Apps**. The bot app should be listed here (it is the app
   whose webhook points at Railway).
4. **Accounts** > **Pages** shows the yarnOga Page, and **Accounts** >
   **Instagram accounts** shows yarnoga, now that you moved them in.
5. **Users** > **System users**. `whatsapp-bot` should be listed. A system
   user belongs to one portfolio and can only be given assets from that
   portfolio, so it must be in Kahn Prints.

If all five are true, nothing needs moving.

## Step 2: Give whatsapp-bot every asset (5 minutes)

Still in **Users** > **System users** > **whatsapp-bot** > **Assign assets**,
make sure it has **Full control** of:

- the bot app,
- WhatsApp account 1463401605808243,
- WhatsApp account 2332559297282667,
- the yarnOga Facebook Page,
- the yarnoga Instagram account.

Pages and Instagram accounts that were moved in from another portfolio
usually lose their old assignments, so check the last two.

### Do we need a new token?

A system user's token reaches whatever the system user has been given, at the
time it is used. So adding assets in step 2 does **not** need a new token.

Make a new one only if Railway's `WHATSAPP_ACCESS_TOKEN` or
`META_SOCIAL_TOKEN` was made by a different system user or another portfolio,
or if step 7 shows an error. To make one: **whatsapp-bot** > **Generate new
token** > pick the bot app > expiry **Never** > tick the permissions below >
**Generate**, copy it straight away, and paste it into Railway.

| Railway variable | Permissions to tick |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | `whatsapp_business_messaging`, `whatsapp_business_management` |
| `META_SOCIAL_TOKEN` | `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights` |

Making a new token doesn't switch off the old one, so nothing breaks while
you swap it over.

## Step 3: Add a payment method (5 minutes, do this now)

Meta charges for messages the bots send, and since **1 October 2026** that
includes ordinary replies to customers once a number has used its free
**1,000 service messages** for the month. Without a card on file, sending
stops when the free allowance runs out.

1. <https://business.facebook.com/settings> > **Billing and payments** >
   **Payment methods** > **Add**. Add a card in the business name.
2. Open WhatsApp Manager (<https://business.facebook.com/wa/manage/home>),
   choose WhatsApp account 1463401605808243, then **Account tools** (or
   **Settings**) > **Payment settings**, and attach the card.
3. Do the same for 2332559297282667.

Prepaid and virtual cards are often refused. Some Nigerian naira cards are
refused for dollar charges; a dollar (domiciliary) card is the usual fix.

Add the card to the cost ledger as a recurring Meta expense once the first
bill arrives.

## Step 4: Put the quote demo number on (20 minutes)

The demo number is +234 704 897 1600. It must **not** be logged in to the
WhatsApp or WhatsApp Business app on any phone: if it is, delete the account
in that app first (Settings > Account > Delete account). Have the SIM in a
phone that can receive an SMS or call.

1. WhatsApp Manager > account **2332559297282667** > **Phone numbers** >
   **Add phone number**. Display name: `yarnOga`. Category: Professional
   services. Enter the number and type the code Meta sends.
2. Click the new number and copy its **Phone number ID** (a long number that
   is not the phone number).
3. Register it so it can send messages. Open
   <https://developers.facebook.com/tools/explorer>, pick the bot app, paste
   the whatsapp-bot token (Railway's `WHATSAPP_ACCESS_TOKEN`) into **Access
   token**, change GET to **POST**, and enter `PHONE_NUMBER_ID/register`.
   Under **Params** add `messaging_product` = `whatsapp` and `pin` = a
   6-digit PIN you make up. Click **Submit**: you want `{"success": true}`.
   Keep the PIN somewhere safe: it is the number's two-step verification PIN
   and Meta asks for it again if the number is ever moved.
4. Back on the number in WhatsApp Manager, make sure **Subscribe webhooks**
   is on. Because the flyer number in the same account already receives
   messages, the account is already linked to the bot app; nothing else to do.
5. In Supabase: check that migration `0020_quote_businesses.sql` and
   `supabase/seed/demo_quote_business.sql` have been run (Table editor should
   show `quote_businesses` with a "yarnOga Demo Shop" row). Run them if not.
6. In that row: paste the Phone number ID into `phone_number_id`, put your
   number in `owner_wa_id` if you want to see demo order alerts, and set
   `active` to true.
7. On Railway, set `QUOTE_MULTI_BUSINESS=true` if it isn't already.
8. From another phone, send "How much for 20 branded T-shirts?" to
   +234 704 897 1600. The Demo Shop should quote within a few seconds.
9. To let businesses sign up on this number by chat: run migration
   `0039_quote_chat_signup.sql` in Supabase, then on Railway set
   `QUOTE_SIGNUP_PHONE_NUMBER_ID` to the same Phone number ID (and, if you
   want a message for each sign-up, `QUOTE_SIGNUP_ALERT_WA_ID` to your
   number). Send "sign up" to +234 704 897 1600 to try it.

If no reply and Railway's logs show nothing arriving, re-run
`2332559297282667/subscribed_apps` as a POST in the Graph API Explorer (as in
docs/META_SETUP.md step 6b).

Register can be called 10 times per number in 72 hours. After that Meta
blocks it for 3 days, so if it fails, read the error before retrying.

---

## What verification unlocks

| What | What it means for us | What it needs |
| --- | --- | --- |
| Higher messaging limit | Unverified portfolios can start conversations with 250 people a day. Verification lifts this to 2,000 straight away. After that Meta raises it automatically (10,000, then 100,000, then unlimited) when we keep quality high and use at least half the limit within 7 days. | Nothing. Check it in WhatsApp Manager > Account tools > Messaging limits. |
| Display names | Verified businesses get more room with names: a brand name like yarnOga can be approved even though the verified company is Kahn Prints, as long as the link is visible. | yarnoga.com should say "yarnOga is a product of Kahn Digital Company Limited" (or Kahn Prints) in the footer. |
| App Review for WhatsApp | Lets the app manage WhatsApp numbers for **other** businesses. | Step 5. |
| Tech Provider | Lets clients connect their own numbers through our /signup page (Embedded Signup), with or without keeping the WhatsApp Business app (coexistence). | Steps 5 and 6. |
| Instagram comment bot | For **our own** Instagram account, standard access is enough: no App Review needed. App Review (`instagram_manage_comments`, advanced access) is only needed to run it for clients' accounts. | Step 8, only when selling it. |
| Green tick (Official Business Account) | Optional. Meta decides based on how well known the brand is (press coverage, not paid ads). | Later; apply from WhatsApp Manager once there is press coverage. |

---

## Step 5: Ask Meta for advanced access (when ready to onboard clients)

In the bot app: **App review** > **Permissions and features** > request
**Advanced access** for `whatsapp_business_management` and
`whatsapp_business_messaging`. Meta wants two short screen recordings: one of a
message sent from our system arriving in WhatsApp, and one of a message
template being created. Ask only for what we use; extra permissions are the
most common reason for refusal. Claude can write the answers with you.

## Step 6: Become a Tech Provider and switch on sign-up

Once step 5 is approved, the app dashboard shows **Tech Provider onboarding**
(under **Use cases** > the WhatsApp use case > **Customize**). Finish its
checklist, then follow docs/COEXISTENCE.md steps 4 to 6 to switch on the
/signup page.

## Step 7: Check the dashboard socials still work (2 minutes)

Moving the Page and Instagram account doesn't change the Page ID, so
`FACEBOOK_PAGE_ID` on Railway stays as it is.

1. Open `https://<your-railway-address>/dashboard`.
2. The Facebook and Instagram cards should show follower numbers.
3. If one shows "error", the token lost access in the move: redo step 2 for
   the Page and Instagram account. If it still fails, make a new
   `META_SOCIAL_TOKEN` (step 2) and update it on Railway.
4. To see exactly what a token can reach, paste it into
   <https://developers.facebook.com/tools/debug/accesstoken>: it lists the
   permissions and the accounts it covers.

## Step 8: Instagram comment bot for clients (later)

Only when we sell it to other businesses: **App review** > request advanced
access for `instagram_manage_comments` and `instagram_basic`. Needs the app
in Live mode, a privacy policy page on yarnoga.com, and a screen recording.

## Step 9: Site reporter number (later)

When a number is chosen, repeat step 4 parts 1 to 4 for it, then put its Phone
number ID in Railway as `SITE_PHONE_NUMBER_ID`.

---

## Where these facts come from

Checked against Meta's developer documentation on 20 October 2026:
messaging limits (start at 250, 2,000 after verification, automatic increases
checked every 6 hours, shared across the portfolio), number registration
(PIN, 10 tries in 72 hours), pricing (per message, service messages charged
from 1 October 2026), Tech Provider steps, and Instagram access levels.

Not confirmed from Meta's own pages: the exact free allowance of 1,000 service
messages per number (reported by respond.io), the menu names for payment
settings, and display name rules (taken from WhatsApp partners' guides).
Meta's site could not be opened directly from here, so check the screen if
anything looks different.

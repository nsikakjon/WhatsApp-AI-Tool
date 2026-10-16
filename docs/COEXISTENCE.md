# Owner and bot on the same number (WhatsApp coexistence)

Today, a number that runs the bot can't also be used in the WhatsApp Business
app on your phone, so the bot answers every chat. Meta's **coexistence** feature
lets one number do both: you keep the WhatsApp Business app (chats, calls,
catalogue, groups) and the bot works alongside it.

## What the bot does

- When you reply to a customer from the WhatsApp Business app, the bot goes
  quiet **in that chat only** for 60 minutes after your latest message.
- Every message you send pushes the 60 minutes further out, so the bot never
  cuts in while you're in the middle of a conversation.
- Once you've been silent in that chat for 60 minutes, the bot answers the
  customer's next message again. It can see what you said, so it picks up
  where you left off.
- Other customers' chats carry on with the bot as normal.
- To change the 60 minutes, set `OWNER_REPLY_PAUSE_MINUTES` on Railway
  (for example `30`). `0` switches the pause off.

The code is ready, but it only switches on once Meta starts sending us copies
of the messages you send from the app. That needs the steps below.

## Before you start: things to know

1. **Nigeria may not be supported yet.** Meta doesn't publish an official
   country list. Some guides say Nigerian (+234) numbers were added in 2026,
   while other, newer guides still list Nigeria as not supported. The only way
   to be sure is to try the sign-up in step 3: if Meta doesn't offer the
   "connect your existing WhatsApp Business app" option for the number, it isn't
   available yet.
2. **The number has to live in the WhatsApp Business app first.** Coexistence
   works the other way round from what we did before: you start with a number
   already in the app, then connect it to the bot. Guides say Meta wants the
   app to be on version 2.24.17 or newer and the number to have been in active
   use in the app for at least 7 days.
3. **The KahnPrints number (+234 811 433 0749) is currently connected straight
   to the bot**, not to the app. Moving it means removing it from the bot,
   putting it in the WhatsApp Business app, using it there for a week, then
   connecting it back. **The bot won't answer KahnPrints customers during that
   week.** You may prefer to try this first on a spare number.
4. Connecting needs a small **sign-up page** (Meta calls it "Embedded Signup")
   where you scan a QR code with the WhatsApp Business app. That page isn't
   built yet; it's the next piece of work if you want to go ahead.

## Steps on the Meta side

### Step 1: Run the database change

In Supabase: **SQL Editor** > **New query** > paste the contents of
`supabase/migrations/0014_owner_reply_pause.sql` > **Run**.

### Step 2: Switch on the new webhook field

1. Go to <https://developers.facebook.com> > **My Apps** > your bot app.
2. Open **WhatsApp** > **Configuration** and find **Webhook fields**.
3. Find **smb_message_echoes** and click **Subscribe** (the switch turns on).
   Leave **messages** on as it is.

This is what lets Meta tell the bot "the owner just replied to this person".
It's safe to do now: nothing changes until a number is connected with
coexistence.

### Step 3: Connect the number with coexistence

This uses the sign-up page from point 4 above. Once it's built, the flow is:

1. Open the sign-up page, log in with Facebook and choose your business.
2. When asked about the phone number, choose the option to **connect your
   existing WhatsApp Business app**.
3. Meta shows a QR code. On your phone, open the WhatsApp Business app and scan
   it (the app guides you; it may ask whether to share your chat history).
4. Tell Claude the new number's **Phone number ID** so Railway can be updated.

## How to check it works

1. From a different phone, message the business number. The bot answers.
2. From the WhatsApp Business app on the business phone, reply to that chat.
3. From the other phone, send another message. The bot stays quiet.
4. Wait 60 minutes (or set `OWNER_REPLY_PAUSE_MINUTES=2` on Railway to test
   quickly) and message again. The bot answers.

In the Railway logs you'll see lines like
`Owner replied to ...5678: bot paused in that chat for 60 minutes`.

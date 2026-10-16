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
   to be sure is to try the sign-up in step 6: if Meta doesn't offer the
   "connect your existing WhatsApp Business app" option for the number, it isn't
   available yet.
2. **The number has to live in the WhatsApp Business app first.** Coexistence
   works the other way round from what we did before: you start with a number
   already in the app, then connect it to the bot. Guides say Meta wants the
   app to be on version 2.24.17 or newer and the number to have been in active
   use in the app for at least 7 days.
3. **Each business connects its own number.** KahnPrints keeps
   +234 811 433 0749, which is connected straight to the bot today. Our test
   number is **+234 701 326 2131**: put it in the WhatsApp Business app on a
   phone and use it there for a week. Don't run Meta's "register" step on it,
   because that would take it out of the app.
4. **yarnOga has to become a Meta "Tech Provider"** before other businesses
   can connect through our sign-up page. That needs business verification and
   Meta's App Review (steps 3 and 4 below). Your own numbers can usually be
   connected while the app is still in development, because you are an admin
   of the app.

## Steps on the Meta side

### Step 1: Run the database changes

In Supabase: **SQL Editor** > **New query**. Paste the contents of each file,
then click **Run**:

1. `supabase/migrations/0014_owner_reply_pause.sql`
2. `supabase/migrations/0016_whatsapp_connections.sql`

### Step 2: Switch on the new webhook field

1. Go to <https://developers.facebook.com> > **My Apps** > your bot app.
2. Open **WhatsApp** > **Configuration** and find **Webhook fields**.
3. Find **smb_message_echoes** and click **Subscribe** (the switch turns on).
   Leave **messages** on as it is.

This is what lets Meta tell the bot "the owner just replied to this person".
It's safe to do now, because nothing changes until a number is connected
with coexistence.

### Step 3: Verify the business (your CAC documents)

1. Go to <https://business.facebook.com> > **Settings** > **Security Centre**
   (sometimes **Business info**) > **Start verification**.
2. Enter the legal business name exactly as on the CAC certificate, plus the
   address, phone number and website (yarnoga.com).
3. Upload the CAC certificate of registration (and, if asked, a utility bill
   or bank statement showing the same name and address).
4. Meta checks it, usually within a few days. You'll get an email.

### Step 4: Make the sign-up pop-up and ask Meta for approval

1. In your bot app: **Add product** > **Facebook Login for Business**.
2. **Facebook Login for Business** > **Settings**: under **Allowed domains
   for the JavaScript SDK**, add your Railway address (for example
   `https://your-app.up.railway.app`).
3. **Facebook Login for Business** > **Configurations** > **Create
   configuration**. Name it "WhatsApp sign-up", choose the login variation
   **WhatsApp Embedded Signup**, and pick the permissions
   `whatsapp_business_management` and `whatsapp_business_messaging`. Save,
   then copy the **Configuration ID**.
4. **App review** > **Permissions and features**: request **Advanced access**
   for `whatsapp_business_management` and `whatsapp_business_messaging`.
   Meta asks how you use them and usually wants a short screen recording of
   the sign-up page and the bot replying. Claude can write the answers with
   you when you get there.

### Step 5: Switch the sign-up page on (Railway)

In Railway > **Variables**, add:

| Variable | Value |
| --- | --- |
| `SIGNUP_PASSWORD` | A password you invent for the page |
| `META_APP_ID` | Meta app > **App settings** > **Basic** > **App ID** |
| `META_SIGNUP_CONFIG_ID` | The Configuration ID from step 4 |

While `SIGNUP_PASSWORD` is empty the page stays switched off, and nothing
changes for the bots that are already live.

### Step 6: Connect the number

1. On a computer, open `https://<your-railway-address>/signup` and type the
   password (any username works).
2. Click **Connect my WhatsApp Business app**, log in with Facebook and choose
   your business.
3. Choose the option to **connect your existing WhatsApp Business app**.
4. Meta shows a QR code. Scan it with the WhatsApp Business app on the phone
   with that number. The app guides you and may ask whether to share your chat
   history.
5. The page then shows the number's **Phone number ID**. Send it to Claude so
   the right bot is switched on for that number.
6. In **Business Settings** > **System users**, give the `whatsapp-bot` system
   user access to the new WhatsApp account (**Assign assets**, full control),
   so the bot's key can send messages from that number.

## How to check it works

1. From a different phone, message the business number. The bot answers.
2. From the WhatsApp Business app on the business phone, reply to that chat.
3. From the other phone, send another message. The bot stays quiet.
4. Wait 60 minutes (or set `OWNER_REPLY_PAUSE_MINUTES=2` on Railway to test
   quickly) and message again. The bot answers.

In the Railway logs you'll see lines like
`Owner replied to ...5678: bot paused in that chat for 60 minutes`.

# Setting up Meta: app, test number and webhook

This connects WhatsApp to the server. When you're done, you'll send a WhatsApp
message to Meta's free test number and get "You said: ..." back.

**Order of work:**

1. Steps 1 to 4 below (Meta): create the app and collect three values.
2. [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md): set up Supabase and Railway using those values.
3. Steps 5 to 8 below (Meta): point Meta's webhook at Railway, then test.

Meta changes its dashboard wording now and then. If a button name doesn't match
exactly, look for the closest equivalent; the overall flow stays the same.

---

## Step 1: Become a Meta developer

1. Go to <https://developers.facebook.com> and log in with your Facebook account.
2. Click **Get Started** (top right) if you haven't used it before, and follow the
   prompts: accept the terms, verify your phone number or email, choose
   "Developer" as your role.

## Step 2: Create the app

1. Go to **My Apps** > **Create App**.
2. App name: e.g. `KahnPrints Bot`. Contact email: your email. Click **Next**.
3. Use case: choose **Connect with customers through WhatsApp**. Click **Next**.
4. Business portfolio: pick your business if it's listed, or create one
   (e.g. `KahnPrints`). You can complete business verification later; it isn't
   needed for testing.
5. Finish the remaining screens and click **Create app**. Re-enter your Facebook
   password if asked.

## Step 3: Get the test number and its details

1. In the app dashboard, open the WhatsApp section in the left menu
   (**WhatsApp** > **API Setup**, or **Use cases** > **Customize** > **API Setup**).
   Meta gives you a free **test phone number** automatically.
2. On that page, note down:
   - **Temporary access token**: click **Generate access token** if none is shown.
     This goes in `WHATSAPP_ACCESS_TOKEN`. It **expires after 24 hours**; step 8
     replaces it with a permanent one.
   - **Phone number ID**: shown under the "From" test number. This goes in
     `WHATSAPP_PHONE_NUMBER_ID`. It's a long number, and it is *not* the phone
     number itself.
3. Add your own WhatsApp number as a test recipient:
   - In the **To** field, choose **Manage phone number list** > **Add phone number**.
   - Enter your number with country code, e.g. `+234 801 234 5678`.
   - Meta sends a code to your WhatsApp; enter it.
   - The test number can only talk to up to 5 numbers you add here.
4. Optional sanity check: with your number selected in **To**, click
   **Send message**. You should receive a "Hello World" WhatsApp message from the
   test number. Save that test number to your phone's contacts.

## Step 4: Get the app secret

1. Left menu: **App settings** > **Basic**.
2. Next to **App secret**, click **Show** (enter your password) and copy it.
   This goes in `WHATSAPP_APP_SECRET`. The server uses it to confirm every
   incoming message really came from Meta.

Now follow [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md), then come back for step 5.
Also decide on your `WHATSAPP_VERIFY_TOKEN` (any long random string) and put it
in Railway.

---

## Step 5: Connect the webhook

The webhook is the address Meta sends incoming messages to.

1. Make sure `https://<your-railway-domain>/health` shows `{"ok":true}`.
2. In the Meta app, open **WhatsApp** > **Configuration**.
3. Under **Webhook**, click **Edit** and fill in:
   - **Callback URL**: `https://<your-railway-domain>/webhooks/whatsapp`
   - **Verify token**: exactly the same value as `WHATSAPP_VERIFY_TOKEN` in Railway.
4. Click **Verify and save**. Meta calls the server once to check it; in
   Railway's logs you'll see `WhatsApp webhook verified`.
   If Meta shows an error, see Troubleshooting below.

## Step 6: Subscribe to messages

Still on **WhatsApp** > **Configuration**, under **Webhook fields**, click
**Manage** and turn on (**Subscribe**) the **messages** field. Without this,
Meta won't send you anything.

### Step 6b: Link the app to your WhatsApp account

Meta's **Test** button can reach the server even when messages from real phones
don't. If you send a message from your phone and nothing at all appears in
Railway's logs, the WhatsApp account isn't forwarding its messages to your app yet:

1. On the API Setup / **Step 1. Try it out** page, copy the **WhatsApp Business
   Account ID** (not the Phone number ID).
2. Open <https://developers.facebook.com/tools/explorer>.
3. Set **Meta App** to your app, add the permissions
   `whatsapp_business_management` and `whatsapp_business_messaging`, and click
   **Generate Access Token**.
4. Change **GET** to **POST**, enter `YOUR_WABA_ID/subscribed_apps`, and click
   **Submit**. You should see `{"success": true}`.

## Step 7: Test it

1. From the WhatsApp number you added in step 3, send any text to the test number,
   e.g. `Hello`.
2. Within a few seconds you should get back: `You said: Hello`.
3. Send a voice note or photo: you should get
   `I got your audio message. For now I can only echo text.` (or `image`).
4. In Supabase, open **Table Editor** > `messages`: you'll see both your message
   (`inbound`) and the bot's reply (`outbound`). `contacts` has a row for you.

That's Phase 0 working end to end.

## Step 8: Replace the 24-hour token with a permanent one

Do this once things work, otherwise the bot stops replying the next day.

1. Go to <https://business.facebook.com/settings> (Business settings) and pick
   your business portfolio.
2. **Users** > **System users** > **Add**. Name it e.g. `whatsapp-bot`, role
   **Admin**. Create it.
3. With the system user selected, click **Assign assets**: choose **Apps**, select
   your app, turn on **Full control** (or "Manage app"), and save. Do the same
   for your **WhatsApp account** (asset type "WhatsApp accounts"), with full control.
4. Click **Generate new token**:
   - App: your app.
   - Expiry: **Never**.
   - Permissions: tick `whatsapp_business_messaging` and
     `whatsapp_business_management`.
   - Click **Generate**, and copy the token straight away (it's shown once).
5. In Railway, set `WHATSAPP_ACCESS_TOKEN` to this new token. Railway redeploys.
6. Send another test message to confirm it still replies.

---

## Troubleshooting

| What you see | Likely cause and fix |
| --- | --- |
| Meta: "The callback URL or verify token couldn't be validated" | Railway isn't running (check `/health`), the URL is missing `/webhooks/whatsapp`, or the verify token doesn't match Railway's `WHATSAPP_VERIFY_TOKEN` exactly (watch for spaces). |
| You message the test number and nothing happens, and Railway logs show nothing | The **messages** webhook field isn't subscribed (step 6), the app isn't linked to the WhatsApp account (step 6b), or you messaged from a number that isn't in the recipient list. |
| Logs: `Rejected WhatsApp webhook with invalid signature` | `WHATSAPP_APP_SECRET` in Railway is wrong. Copy it again from App settings > Basic. |
| Logs: `WhatsApp send failed (401)` | Access token expired or was pasted wrong. Generate a new one (step 3, or step 8 for permanent). |
| Logs: `WhatsApp send failed` mentioning "not in allowed list" (error 131030) | The number you're messaging from isn't on the test recipient list. Add it (step 3). |
| Logs: `upsertContact failed` or `recordInbound failed` | Supabase values are wrong, or the tables weren't created. Recheck Part 1 of the deploy guide. |

## Later: using your real business number

The test number is fine for building and testing. To go live with your own
number (e.g. KahnPrints' number), you'll add it under **WhatsApp** > **API Setup**
> **Add phone number**, complete Meta business verification, and swap
`WHATSAPP_PHONE_NUMBER_ID`. A number already used on the regular WhatsApp or
WhatsApp Business app has to be removed from that app first. We'll do this in a
later phase.

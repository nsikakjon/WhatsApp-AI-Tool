# Instagram comment auto-reply: setup

For the real estate lead qualifier. When someone comments on one of the
account's Instagram posts (for example "How much is this?"), the bot:

1. sends them **one private message** with a tap-to-chat link to the leads
   WhatsApp number, so the WhatsApp bot can ask its questions, and
2. **replies to the comment in public**: "Thanks @name! We've sent you a
   message with the details 📩".

It never mentions prices or availability. Replies to other comments (inside a
comment thread) and the account's own comments are ignored. Each comment is
answered once, even if Meta sends it twice.

It is **off** until `INSTAGRAM_AUTOREPLY=on`. The WhatsApp bots don't depend on
it: if it's switched on with a setting missing, it stays off and the Railway
logs say `Instagram auto-reply is OFF: missing ...`.

## What you need

- An Instagram **Business or Creator** account (Instagram app > Settings >
  Account type and tools). A personal account can't use Meta's API.
- The same Meta app the WhatsApp bots use (developers.facebook.com).

## 1. Create the table (Supabase)

SQL Editor > New query > paste all of
`supabase/migrations/0017_instagram_comment_replies.sql` > Run.

## 2. Add Instagram to the Meta app

1. developers.facebook.com > My Apps > your app > **Add use case** (or Add
   product) > **Instagram** > "API setup with Instagram login".
2. Under **Generate access tokens**, click **Add account** and log in to the
   Instagram account. Copy:
   - the account's **ID** (a long number) → `INSTAGRAM_ACCOUNT_ID`
   - the **token** → `INSTAGRAM_ACCESS_TOKEN`
3. On the same page, copy the **Instagram app secret** → `INSTAGRAM_APP_SECRET`
   (this is not the WhatsApp app secret).
4. Permissions the app needs: `instagram_business_basic`,
   `instagram_business_manage_comments` and
   `instagram_business_manage_messages`.

## 3. Add the settings (Railway)

| Variable | Value |
| --- | --- |
| `INSTAGRAM_AUTOREPLY` | `on` |
| `INSTAGRAM_ACCOUNT_ID` | from step 2 |
| `INSTAGRAM_ACCESS_TOKEN` | from step 2 |
| `INSTAGRAM_APP_SECRET` | from step 2 |
| `INSTAGRAM_WHATSAPP_NUMBER` | the leads WhatsApp number, e.g. `2348012345678` |
| `INSTAGRAM_BUSINESS_NAME` | optional, e.g. `Acme Homes` (otherwise `LEADS_BUSINESS_NAME`) |
| `INSTAGRAM_VERIFY_TOKEN` | optional; leave out to reuse `WHATSAPP_VERIFY_TOKEN` |

Railway redeploys. The log line should end `instagram auto-reply: on`.

## 4. Point Instagram's webhook at the server (Meta)

Same Instagram setup page > **Configure webhooks**:

- Callback URL: `https://<your-railway-url>/webhooks/instagram`
- Verify token: the same as `INSTAGRAM_VERIFY_TOKEN` (or `WHATSAPP_VERIFY_TOKEN`)
- Click **Verify and save**, then switch on the **comments** field.

## 5. Go live (Meta)

While the app is in Development mode, Meta only sends comments from people
who have a role on the app. To answer the public:

1. Submit the app for **App Review** asking for Advanced Access to
   `instagram_business_manage_comments` and
   `instagram_business_manage_messages` (Meta wants a short screen recording
   of a comment getting a reply and a DM).
2. Switch the app to **Live**. This doesn't change anything for WhatsApp.

## Test it

From another Instagram account (one with a role on the app before App
Review), comment on a post. Within a few seconds you should see a DM and a
public reply. Each comment is listed in Supabase > Table Editor >
`instagram_comment_replies` with status `done`, or `failed` and the reason.

## Limits from Instagram

- One private message per comment, and only within 7 days of the comment.
- The private message lands in the person's message requests if they don't
  follow the account.
- Turn it off any time with `INSTAGRAM_AUTOREPLY=off`.

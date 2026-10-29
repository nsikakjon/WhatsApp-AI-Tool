# The bot's address: app.yarnoga.com

The bot server runs on Railway. Railway gave it the address
`https://whatsapp-ai-tool-production.up.railway.app`; these steps make it answer
on `https://app.yarnoga.com` as well, so every link owners, staff, customers and
riders see reads yarnoga.com.

The bot builds its links from the `PUBLIC_URL` variable, so the switch is all
settings, no code. The Railway address keeps working the whole time, and links
sent before the switch (order boards, tracking, rider pages) keep opening.

Do the steps in order. Step 4 is the one that matters: only change `PUBLIC_URL`
once `https://app.yarnoga.com/health` opens.

## 1. Railway: add the domain

Railway > the bot service > **Settings** > **Networking** > **Custom Domain** >
type `app.yarnoga.com`. If it asks for a port, keep the one it suggests.

Railway shows a **CNAME** value (ends in `.up.railway.app`) and sometimes a
**TXT** record. Keep the screen open. Don't remove the Railway address.

## 2. Hostinger: point app.yarnoga.com at Railway

hPanel > **Domains** > yarnoga.com > **DNS / Nameservers** > **DNS records**.
Add:

| Type | Name | Points to | TTL |
|---|---|---|---|
| CNAME | `app` | the CNAME value Railway showed | leave as is |

If Railway showed a TXT record, add it too, exactly as shown. Don't change the
records the website uses (`@`, `www`).

## 3. Wait for the green tick

Railway shows the domain as active once it sees the record, usually within
minutes, sometimes a few hours. It sets up the padlock (https) by itself. Then
open `https://app.yarnoga.com/health`: it should say `{"ok":true}`.

## 4. Railway: change PUBLIC_URL

Railway > Variables:

- `PUBLIC_URL` = `https://app.yarnoga.com` exactly: https, no slash or
  anything after it. A badly written value (a railway.com dashboard link, a
  missing `https://`, a path on the end) stops the bot starting and every
  number goes silent. If that happens, put the old value back.
- `OWNER_APP_URL`: delete it or leave it empty, so the app uses `PUBLIC_URL`.

Railway restarts the bot. From then on the app login link (owner sends
**app**), order boards, tracking and rider links, walk-in QR codes and
Paystack's "back to the shop" page all use `app.yarnoga.com`.

Check: send **app** to the Demo Shop number, tap the link, and see
`app.yarnoga.com` in the address bar. Owners log in again once on the new
address (send **app** again).

Don't do this step before step 3 works. The bot would start, but the links it
sends would not open.

## 5. Outside services

Each one keeps working on the Railway address until you change it, so there's
no rush.

- **Paystack** > Settings > **API Keys & Webhooks** > Live Webhook URL:
  `https://app.yarnoga.com/webhooks/paystack`. Save.
- **Meta, Facebook Login for Business** > Settings > **Allowed domains for the
  JavaScript SDK**: add `https://app.yarnoga.com` (keep the Railway one), so the
  `/signup` page works on the new address. Adding a domain is safe while App
  Review is pending.
- **Meta webhook** (Meta app > WhatsApp > **Configuration** > Callback URL):
  `https://app.yarnoga.com/webhooks/whatsapp`, same verify token, **Verify and
  save**, then send a test message. While App Review is pending, leave this on
  the Railway address: it works just as well, and it's the one thing that would
  stop every number if it went wrong. Change it after approval.
- **Privacy and data deletion URLs** (Meta app > App settings > Basic): these
  are `yarnoga.com/privacy` and `yarnoga.com/data-deletion` on the website, not
  the bot, so nothing changes.
- **GitHub uptime check** (only if set up, docs/MONITORING.md): change the
  `HEALTH_URL` variable to `https://app.yarnoga.com/health/full`.
- **TikTok** (only if you use it, docs/DASHBOARD.md): add
  `https://app.yarnoga.com/dashboard/tiktok/callback` as a redirect address.

## 6. Website

The website's visit counter and reply generator call the bot. Upload the
website files that use `app.yarnoga.com` only after step 3 works; until then
the current files, which use the Railway address, keep working.

## 7. Bookmarks

Use `https://app.yarnoga.com/inbox`, `/dashboard`, `/quote-setup` and `/home` (the owner app; old `/app` links still work).
Each asks you to log in once on the new address.

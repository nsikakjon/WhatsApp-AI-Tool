# Owner dashboard

One page that shows how every yarnOga product is doing, read live from the
database each time you open or refresh it.

## Switching it on

1. Railway > your service > **Variables** > add `DASHBOARD_PASSWORD` with a
   long password you make up. Save; Railway redeploys.
2. Open `https://<your-railway-url>/dashboard` (the same address Meta's webhook
   uses, with `/dashboard` on the end instead of `/webhooks/whatsapp`).
3. The browser asks for a username and password. Type anything as the
   username and your `DASHBOARD_PASSWORD` as the password.

Leave `DASHBOARD_PASSWORD` empty and the page is switched off.

## What it shows

| Section | Numbers |
| --- | --- |
| WhatsApp, all numbers | people who have messaged, messages in and out, voice notes, a 30-day chart |
| yarnOga Flyers | groups, members, birthday flyers sent, groups per plan, what paid plans are worth per month at list price |
| Sales assistant (KahnPrints) | paid sales (orders marked paid), confirmed orders awaiting payment, quotes |
| Site Reporter | active sites, team members, updates, photos, voice notes, daily reports |
| Lead qualifier | enquiries, hot/warm/cold, handed to an agent |
| Socials and website | links only, marked "Not connected" until each account is connected |

"Paid plans are worth" is the monthly list price of the plans groups are on,
not money received: flyer payments aren't recorded in the database yet.

Nothing on the page is estimated. Every number is a count or sum of real rows.

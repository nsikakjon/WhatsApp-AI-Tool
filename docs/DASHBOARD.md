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
| Profit and loss | income, costs and profit or loss per month and in total, costs and income by category, every entry |
| WhatsApp, all numbers | people who have messaged, messages in and out, voice notes, a 30-day chart, and messages each number sent this month with how many are past Meta's free 1,000 (needs migration 0043) |
| yarnOga Flyers | groups, members, birthday flyers sent, groups per plan, what paid plans are worth per month at list price |
| Sales assistant (KahnPrints) | paid sales (orders marked paid), confirmed orders awaiting payment, quotes |
| Site Reporter | active sites, team members, updates, photos, voice notes, daily reports |
| Lead qualifier | enquiries, hot/warm/cold, handed to an agent |
| Website (yarnoga.com) | visitors today, page views, a 30-day visitors chart, top pages and where visitors came from |
| Socials | Instagram, Facebook, TikTok and YouTube numbers once connected (below) |

"Paid plans are worth" is the monthly list price of the plans groups are on,
not money received: flyer payments aren't recorded in the database yet.

Nothing on the page is estimated. Every number is a count or sum of real rows.
The dashboard only reads, except for the profit and loss entries you add or
remove yourself.

## Profit and loss

The top section is yarnOga's own money: what it has cost and what it has
earned. It only counts entries you add, because flyer plan payments and setup
fees aren't recorded automatically yet. KahnPrints sales are the shop's money,
so they aren't counted here.

To switch it on, once: Supabase > **SQL Editor** > **New query** > paste all of
`supabase/migrations/0024_money_lines.sql` > **Run**. That also copies in the
costs already in the cost ledger spreadsheet (₦82,432.90 at ₦1,370 to $1, all
on 11 Oct 2026). Running it twice is safe. Until it's run, the section says it
couldn't read the entries and the rest of the dashboard works as normal.

Adding money in or out: fill in **Add an entry** at the bottom of the section
and press **Save entry**. For a dollar cost, choose Dollars and type the naira
rate you paid at; the dashboard keeps both the dollar amount and its naira
value. Monthly bills (Railway, hosting, Claude Pro) aren't added by themselves:
add each one when it is paid, so the page never shows a cost that didn't
happen. A wrong entry can be taken out with **Remove**.

## Connecting socials

Each account is separate: connect them in any order. Until an account's values
are on Railway it shows "Not connected"; if a value is wrong it shows "Couldn't
load" with the platform's reason. Social numbers refresh every 10 minutes.
After adding variables on Railway, wait for the redeploy, then refresh the
dashboard.

### Instagram and Facebook (one Meta token covers both)

1. In the Instagram app, make sure yarnoga is a **Professional** account
   (Settings > Account type and tools), and link it to the useyarnoga
   Facebook Page (Meta Business Suite > Settings > Linked accounts, or the
   Page's Settings > Linked accounts > Instagram).
2. Go to [business.facebook.com/settings](https://business.facebook.com/settings),
   the same business portfolio that holds your WhatsApp numbers.
   - **Accounts > Pages**: if useyarnoga isn't listed, click **Add** and add it.
   - **Accounts > Instagram accounts**: add yarnoga the same way if it's missing.
3. **Users > System users > whatsapp-bot > Assign assets**: give it the
   useyarnoga Page and the yarnoga Instagram account (full control is simplest).
4. Still on whatsapp-bot, click **Generate new token**, pick your app, choose
   **Never** for expiry, and tick: `pages_show_list`, `pages_read_engagement`,
   `read_insights`, `instagram_basic`, `instagram_manage_insights`.
   (If one isn't offered, add the Facebook Page or Instagram use case to the app
   in the Meta app dashboard, then come back.)
5. Find the Page ID: open the useyarnoga Page > **About** > **Page transparency**,
   or Business settings > Accounts > Pages, where the ID shows when you click it.
6. On Railway add `META_SOCIAL_TOKEN` (the token) and `FACEBOOK_PAGE_ID` (the ID).

Shows: Instagram followers, posts, accounts reached and engaged (last 28 days);
Facebook followers and Page likes.

### YouTube

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create
   a project (any name, e.g. yarnoga-dashboard).
2. **APIs & Services > Library**: search **YouTube Data API v3** and click **Enable**.
3. **APIs & Services > Credentials > Create credentials > API key**. Optionally
   click **Restrict key** and limit it to YouTube Data API v3.
4. On Railway add `YOUTUBE_API_KEY`. (`YOUTUBE_HANDLE` defaults to yarnoga.)

Shows: subscribers, total views, number of videos. Free; no billing needed.

### TikTok

TikTok only shares numbers with an app the account owner signs in to, so this
takes two parts.

1. Go to [developers.tiktok.com](https://developers.tiktok.com), log in with
   the yarnoga TikTok account, and create an app (**Manage apps > Connect an app**).
2. In the app, add the **Login Kit** product with the scopes `user.info.basic`
   and `user.info.stats`, and add this redirect URI:
   `https://app.yarnoga.com/dashboard/tiktok/callback`
3. `user.info.stats` needs TikTok's approval for a live app. To skip the wait,
   use the app's **Sandbox**: create one, add the yarnoga account as a
   **target user**, and use the Sandbox's keys in the next step.
4. On Railway add `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` (from the app's
   or Sandbox's **Credentials**).
5. After the redeploy open
   `https://app.yarnoga.com/dashboard/tiktok/connect`,
   sign in as yarnoga and allow access. The page then shows a key: add it on
   Railway as `TIKTOK_REFRESH_TOKEN`.

Shows: followers, likes, number of videos. The key lasts about a year; when
TikTok shows "Couldn't load", repeat step 5.

### Website

yarnoga.com counts its own visitors: a few lines of code at the bottom of
every page tell the app "someone opened this page", and the app saves it.

- No cookies, so the site needs no cookie banner, and no other company sees
  your visitors.
- IP addresses are never saved. Each visitor gets a code that changes every
  day, so "visitors" means people per day.
- Search engines, link previews (WhatsApp, Facebook) and scripts are left out.
- Views from the site's own address only: copies of the pages opened anywhere
  else are ignored.

To switch it on, once:

1. Supabase > **SQL Editor** > **New query** > paste all of
   `supabase/migrations/0016_site_visits.sql` > **Run**.
2. Upload the latest `yarnoga-site.zip` to Hostinger (every page now carries
   the counter).

Until step 1 is done the Website section says it couldn't read the numbers;
the rest of the dashboard works as normal. Visits are counted from the moment
the new pages are live; nothing before that can be recovered.

If the Railway address ever changes, the counter's address at the bottom of
each site page (search for `yarnOga visitor counter`) must change too.

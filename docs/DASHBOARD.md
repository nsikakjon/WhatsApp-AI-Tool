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

If the password is refused: the username doesn't matter (leave it empty or
type anything), so it's the password. Copy it again from Railway, in case it
was changed when the secrets were rotated. After 5 wrong tries from one
connection the page refuses every password for 15 minutes, so wait before
trying again.

## What it shows

The page is split into four tabs along the top bar, with the tools (tally
sheet, plan editor, numbers to connect) next to them:

- **Overview**: the headline numbers (tap one to open its tab), a **Needs a
  look** list (shops losing money, sections that couldn't load) and the tools.
- **Money**: profit and loss, spending against the plan, and the cost to serve each shop.
- **Marketing**: leads from ads, website visitors and socials.
- **Products**: WhatsApp, flyers, sales assistant, site reporter and leads.


| Section | Numbers |
| --- | --- |
| Profit and loss | income, costs and profit or loss per month and in total, costs and income by category, every entry |
| Against the plan | each month's ads, running costs, income and profit or loss next to the Base case of the 28 Oct projection |
| WhatsApp, all numbers | people who have messaged, messages in and out, voice notes, a 30-day chart, and messages each number sent this month with how many are past Meta's free 1,000 (needs migration 0043) |
| yarnOga Flyers | groups, members, birthday flyers sent, groups per plan, what paid plans are worth per month at list price |
| Sales assistant (KahnPrints) | paid sales (orders marked paid), confirmed orders awaiting payment, quotes |
| Site Reporter | active sites, team members, updates, photos, voice notes, daily reports |
| Lead qualifier | enquiries, hot/warm/cold, handed to an agent |
| Website (yarnoga.com) | visitors today, page views, a 30-day visitors chart, top pages and where visitors came from |
| Google Analytics (yarnoga.com) | users, new users, sessions and page views over 30 days, a users-per-day chart, top pages and traffic sources, once connected (below) |
| Socials | Instagram, Facebook, TikTok and YouTube numbers once connected (below) |

"Paid plans are worth" is the monthly list price of the plans groups are on,
not money received: flyer payments aren't recorded in the database yet.

Nothing on the page is estimated, except the shop costs below. Every other number is a count or sum of real rows.
The dashboard only reads, except for the profit and loss entries you add,
edit or remove yourself.

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
happen. To fix an entry (say, an ad payment saved as One-off instead of
Marketing), press **Edit** next to it, change what's wrong and press **Save
changes**. **Remove** takes an entry out altogether.

## Against the plan

Under profit and loss, each month from November 2026 shows what was actually
spent and received next to the Base case of the projection spreadsheet
(`accounts/yarnoga-projection-2026-10-28.xlsx`). Costs with the category
**Marketing** count as ads; every other cost counts as running costs. A month
that spends more than the plan shows on the Overview under "Needs a look".
The planned figures live in `src/dashboard/projection.ts`: when the
spreadsheet is rebuilt, those rows are replaced to match.

## Cost to serve each shop

Shows what each quote shop costs yarnOga this month (AI replies, voice notes
and Meta's message fees) against what its plan pays, and flags the shops and
paid plans that will cost more than they pay by the end of the month at the
current pace. Our other numbers (flyers, leads, site reports) are listed
underneath for the full picture.

To switch it on: run `supabase/migrations/0065_usage_costs.sql` in Supabase,
then add `SHOP_COSTS` = `true` in Railway. Counting starts from then, so the
first month is partial.

How the figures are worked out:

- AI and voice notes are priced when each one happens, at Anthropic's and
  Groq's list prices in dollars (in `src/core/usage.ts`; change them there if
  a provider changes its price).
- Meta: $0.0067 for every message a number sends past its free 1,000 a month
  (resellers' October 2026 figure for Nigeria; WhatsApp Manager > Billing has
  the exact rate). A number a business connected itself is billed to them.
- Dollars become naira at the latest dollar rate in your profit and loss
  entries (₦1,370 until you add one).
- "Pays a month" is the plan's monthly list price, not money received. A
  branch counts under its main shop. Owner test screens aren't counted.

## Tally sheet

A page at `/dashboard/tally` (same password; **Tally sheet** link in the top
bar) for door-to-door sales days, filled in on the phone between shops:

- **Add a shop**: name, type, where it is, and four ticks: owner in,
  interested, signed up, live today. Ticking a later step ticks the earlier
  ones. Add a follow-up day for an owner who said "not now".
- The day's tiles show shops visited, interested and live against the day's
  goal (20 visited, 5 interested, 2 live).
- Each shop's row can be changed later: change the ticks or the follow-up day
  and press **Save** on that row.
- **Follow-ups** lists every shop with a follow-up day that isn't live yet,
  soonest first, marked **Due** from that day on.
- **Every day out** totals each day, and the day picker opens an earlier day.

Run `supabase/migrations/0079_door_visits.sql` once in Supabase first. No
Railway setting is needed.

## Partnerships

A page at `/dashboard/partners` (same password; **Partnerships** link in the
top bar) for the events, fairs and organisers we pitch in-kind partnerships
to:

- **Add an event or organiser**: name, kind, event day, where, contact (who
  and how to reach them), what we offered, status, day sent, follow-up day, a
  link and notes.
- Statuses: To contact, Sent, Replied, Meeting, Agreed, Declined, No reply.
  Marking a lead **Sent** fills in today as the day sent and a follow-up 5
  days later, unless you pick the days yourself.
- **Follow-ups** lists every lead with a follow-up day that isn't Agreed or
  Declined, soonest first, marked **Due** from that day on.
- **Edit** on a row opens it in the form; **Remove** deletes it.

Run `supabase/migrations/0088_partner_leads.sql` once in Supabase first. It
also adds the leads found so far (only while the list is empty). No Railway
setting is needed.

### Partner packages

Every lead marked **Agreed** gets a panel under **Partner packages** on the
same page, so anyone on the team can set up what we promised them:

- **Discount code**: the code (e.g. TEDXUNIUYO), percent off the first month,
  how many people can use it, the last day it works, which plans it works on,
  and an on/off tick. The panel shows how many have paid with it, how many
  places are left and how many shops gave it when signing up. After the last
  day the bot treats it like a code that has ended.
- **Their shop**: once the partner has signed up on the bot (they send
  "sign up" to 0704 897 1600), type the WhatsApp number they signed up from to
  link their shop. Then set:
  - **Plan** and **Free until**: give them a plan free until a date. After
    that day they go back to Free and get the usual renewal reminders.
  - **What the bot knows**: the FAQs the bot answers from (programme, venue,
    directions, times, who to call), up to 1,500 characters. It's the same
    "About us" the owner can edit in their app, and it shows on their shop
    page. The bot uses it from the next message.
  - **No yarnOga fee**: takes off our 2.5% fee on their pay-link payments
    (tickets, invoices), whatever their plan. Paystack's own charge still
    applies.

  - **Venue address**: gives their shop page a Directions button and gives the
    bot the address with a map link, so it can send directions. Landmarks
    ("enter by Gate 2") go in the FAQs.
- **Links**: their chat link (once their number is connected) for flyers and
  QR codes, their shop page, and the door screen for their door team.
- **Tickets and price list**: everything on their price list, with price,
  how many are left, and for tickets how many sold / let in. **Add a ticket
  type**: event, type (Regular, VIP...), price, how many on sale and a
  picture. It goes on their price list as "Event: Type" and is sold as a ticket
  with a QR code straight away. Typing a type that's already there changes it.
  Each row has **Make it a ticket** / **Not a ticket** and **Remove**.
- **Reminder the day before**: set the start time and tick it on. The day
  before the event day on the lead, from 10am Lagos time, everyone holding a
  ticket that hasn't been used gets a WhatsApp message from the shop's number
  with the time, the address, a map link and "send *my tickets* if you can't
  find it". It goes once, and the panel then shows how many it reached.
- **Event report** (link next to the reminder): tickets sold and let in per
  type, money from ticket orders, how many people chatted to their bot and
  replies sent, the reminder and the discount code. **Print or save as PDF**
  to send it to the partner.

**No sign-up needed:** instead of linking a signed-up shop, press **Create
their shop**. It makes a shop named after the partner on the Free plan, with no
owner yet, and links it. Give it a keyword on the quotes line, then make their
logins under **Organiser logins**: tick **account owner** for the one person
who gets the full app and adds the bank account for ticket money (Settings >
Bank accounts). Everyone else gets an organiser login.

The shop is tied to the partnership by the number the owner signed up from,
not the bot's number, so all of this can be set up before their bot number is
connected (a new SIM, docs/NUMBER_QUEUE.md, or their own number through
Connect with Facebook, docs/COEXISTENCE.md). Chats in the report count once
their own number is live.

#### Partners on the yarnOga quotes line (no SIM needed)

A partner that can't get a number of its own can run its bot on our quotes
line (0704 897 1600). In their shop panel, type a **Keyword on the yarnOga
quotes line**, e.g. TEDXUNIUYO, and save. Then:

- Anyone who sends the keyword (alone or in a short message like "Hi
  TEDxUNIUYO") chats with that partner's bot: its FAQs, tickets, prices and
  pay links. The **Chat link** under Links opens WhatsApp to 0704 with the
  keyword already typed, for flyers and QR codes.
- They stay with that bot until they send **EXIT**, another partner's
  keyword or "sign up", or go quiet for 14 days. Everyone else gets 0704 as
  before: the Demo Shop and sign-up. Someone part way through signing up can
  still type the same word as a promo code.
- Any number of partners can be on the line at once, each with its own
  keyword. Their replies, receipts and the day-before reminder all come from
  0704, and the chat name people see is yarnOga's.
- The event report counts the people who sent the keyword.
- If they later connect their own number, clear the keyword.

All partners share 0704's WhatsApp limits and quality rating, so a partner
whose visitors block or report the number affects everyone on it.

#### Organiser logins

**Organiser logins** in the shop panel gives each person on the partner's
team their own login to the yarnOga app. Type their name and WhatsApp number
and press **Make login link**. The next page shows the link once, with
**Send on WhatsApp** (opens your WhatsApp with the message ready, door screen
link included) and **Copy message**. The link works once, within 24 hours.

They open the app as an **Event organiser**: Dashboard, Inbox, Orders,
Customers and the price list to read, with ticket money. No Settings, bank
details, plan, Pay people, Export, flyers, ads or bot tests. Once in, they
can set a password under Settings, or send "app" to their bot's number for a
new link (for a partner on the quotes line, "app" to 0704). For a partner on
the quotes line, the Inbox shows only people who sent its keyword, from when
they sent it. The shop owner's own number gets their usual full login. The
owner can remove an organiser under Settings > Team.

#### When the event ends

Set **Last day of the event** in the panel (it starts filled in with the
event day). Until that day everything works as set up. Then:

- **The day after**: the partner's keyword on the 0704 line switches off (its
  visitors go back to the yarnOga demo), and organisers who log in see only
  the **Event report**, for 30 days.
- **30 days after the last day**: organiser logins stop working.

The shop owner keeps their full app, and the shop's orders, tickets, chats
and customers are kept. No last day set means nothing switches off. Needs
`0092_partner_event_end.sql`.

#### The reminder template

WhatsApp only delivers an ordinary message to someone who messaged that number
in the last day. For everyone else the reminder needs an approved template:

1. In WhatsApp Manager (the account the shop's number is on), create a
   template: category **Utility**, name `event_reminder`, language English,
   body:
   `Reminder: {{1}} is tomorrow, {{2}}. Venue: {{3}}. Have your ticket's QR code ready at the door. Reply MY TICKETS if you can't find it.`
   Samples: `TEDxUNIUYO`, `Saturday 28 November at 9am`,
   `Main Auditorium, University of Uyo`.
2. Once approved, add `EVENT_REMINDER_TEMPLATE_NAME` = `event_reminder` in
   Railway (and `EVENT_REMINDER_TEMPLATE_LANGUAGE` if it isn't `en`).

Without it, the reminder only reaches people who messaged in the last day.

Run `supabase/migrations/0089_partner_packages.sql` once in Supabase first
(after 0088). Until then the panels say they couldn't load. The only Railway
setting is the optional reminder template above.

The quotes-line keyword needs `0090_shared_line.sql` (the keyword field
appears once it's run) and organiser logins need `0091_organiser_role.sql`.
Both need nothing in Railway beyond the quotes line (QUOTE_SIGNUP_PHONE_NUMBER_ID)
and the owner app already being on.

## Plan editor

A page at `/dashboard/plans` (same password as the dashboard) for changing
plans without SQL:

- Sales assistant plans: monthly and yearly prices, setup fee, orders a month,
  the line owners see when they send "plan", the "Powered by yarnOga" line,
  whether owners are offered the plan, and each feature's on/off and limit.
- Flyer plans: prices only (what each flyer plan includes is set in
  `src/products/flyer/plans.ts`).

Prices are typed in naira and saved in kobo. A blank limit means no limit.
Each plan has its own **Save** button, and the bots use the new figures from
the next message. The website and the cedi, CFA, shilling and dollar prices
(`plan_prices`) don't change from here, so update those too when you change a
price.

To switch it on, add `PLAN_EDITOR` = `true` in Railway. No migration needed.
An **Edit plans** link then appears in the dashboard's top bar.

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

### Google Analytics

Google Analytics (GA) watches yarnoga.com alongside our own counter. It adds
sessions (visits) and where each visit came from (Google search, Instagram,
an ad, typed in). It needs two things: GA's code on every site page, and a
Google Cloud "robot account" that is allowed to read the numbers.

**Part 1: put GA on the website**

1. Go to [analytics.google.com](https://analytics.google.com), signed in with
   the Google account that owns the yarnoga-dashboard Cloud project.
2. **Admin** (gear icon, bottom left) > **Create** > **Property**. Name it
   `yarnOga website`, time zone **Nigeria**, currency **Nigerian Naira**.
   Fill in the business questions and click **Create**.
3. When asked to choose a platform, pick **Web**. Website URL `yarnoga.com`,
   stream name `yarnoga.com`, then **Create stream**.
4. Copy the **Measurement ID** (starts with `G-`). It isn't secret: it shows
   in every page's code. Every page needs GA's tag inside `<head>`:

   ```html
   <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
   <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-XXXXXXXXXX');</script>
   ```

   with your ID in place of `G-XXXXXXXXXX` (twice), then upload the site to
   Hostinger. GA sets cookies, so the privacy page's "Our website" section
   must say so.
5. Back in **Admin** > **Property details**, copy the **Property ID** (a
   number, e.g. `512345678`). This one is for Railway, not the website.

**Part 2: let the dashboard read GA**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and pick
   the **yarnoga-dashboard** project at the top.
2. **APIs & Services > Library**: search **Google Analytics Data API** and click
   **Enable**.
3. **IAM & Admin > Service accounts > Create service account**. Name it
   `ga-dashboard`, click **Create and continue**, skip the roles, click
   **Done**.
4. Click the new account > **Keys** > **Add key** > **Create new key** >
   **JSON** > **Create**. A small file downloads. Treat it like a password:
   don't send it in chat or email.
5. Copy the account's email (ends in `iam.gserviceaccount.com`). In Google
   Analytics: **Admin** > **Property access management** > **+** > **Add users**,
   paste the email, role **Viewer**, untick "Notify new users", **Add**.
6. On Railway add `GA_PROPERTY_ID` (the number from Part 1 step 5) and
   `GA_SERVICE_ACCOUNT_KEY`: open the downloaded file in Notepad, select
   everything from `{` to `}`, and paste it as the value.

After the redeploy the Marketing tab shows the numbers (refreshed every 10
minutes). GA only counts from the day its tag went live on the site. If it
shows "Couldn't load", the reason under it says which step to check.

# Monitoring: health page, uptime alarm and error alerts

Three layers, so Jay hears about a problem before customers do.

| What | Where | Catches |
| --- | --- | --- |
| Health checks | `/health/full` and `/status` on our own server | the database, WhatsApp's API or the AI not answering |
| Watchdog | inside the server, every 5 minutes | a check failing twice in a row (and when it recovers) |
| Uptime alarm | GitHub, every 10 minutes, from outside | the whole server being down (the watchdog can't report that) |
| Error alerts | every error the code logs | a crash while answering a customer, a failed payment step, ... |

Alerts go to Jay on WhatsApp and by email. The same kind of alert is sent at
most once every 30 minutes, and the next one says how many were held back.

## The health pages

- `https://<your-railway-url>/health`: "the server is up". Railway uses this to
  decide whether a new deploy worked. It never calls the database.
- `https://<your-railway-url>/health/full`: every check, as data. Answers 503
  when one fails, which is what uptime monitors look for.
- `https://<your-railway-url>/status`: the same as a page to read. Owners see
  it in the app under **Status** too.

Checks: the database (Supabase), WhatsApp's API (that the access token still
works), the AI (Anthropic; free to check), and when the last customer message
came in (for information; it never fails).

## Switching alerts on

On Railway > your service > **Variables**:

1. `ALERT_WA_ID`: Jay's WhatsApp number with the country code, e.g. `2348012345678`.
2. WhatsApp only delivers ordinary messages within a day of the person's last
   message. So alerts always arrive, make a template:
   WhatsApp Manager > **Message templates** > **Create** > category
   **Utility**, name `system_alert`, language English, body
   `yarnOga alert: {{1}}`. Once approved, set `ALERT_TEMPLATE_NAME=system_alert`.
3. Email: sign up at [resend.com](https://resend.com) (free), add and verify
   the yarnoga.com domain (it gives DNS records to add at Hostinger), create an
   API key, then set `RESEND_API_KEY`, `ALERT_EMAIL` (Jay's address) and
   `ALERT_EMAIL_FROM` (e.g. `yarnOga alerts <alerts@yarnoga.com>`).

## Sentry (error tracking, free tier)

Sentry lists every error with when it happened, how often, and the exact line
of code, which makes fixing much faster than reading logs.

1. Sign up at [sentry.io](https://sentry.io) (Developer plan, free).
2. Create a project: platform **Node.js**, any name (e.g. yarnoga-server).
3. **Project settings > Client Keys (DSN)**: copy the DSN.
4. On Railway set `SENTRY_DSN` to it. Leave `SENTRY_ENVIRONMENT=production`.
5. In Sentry > **Alerts**, the default "new issue" rule emails you for each new
   kind of error.

To stay inside the free quota the server sends at most 30 errors per 10
minutes, and the same error at most once a minute.

## The uptime alarm (outside our server)

The file `.github/workflows/uptime.yml` makes GitHub check `/health/full`
every 10 minutes, three tries a run. It is active once it's on the `main` branch.

1. GitHub > the repository > **Settings > Secrets and variables > Actions**.
2. **Variables** tab > **New repository variable**: `HEALTH_URL` =
   `https://whatsapp-ai-tool-production.up.railway.app/health/full`.
3. For a WhatsApp message (optional), **Secrets** tab, add `ALERT_WA_ID`,
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (the same values as on
   Railway) and `ALERT_TEMPLATE_NAME` (the template from step 2 above).
4. Email: GitHub emails you when a scheduled run fails (GitHub > your profile >
   **Settings > Notifications > Actions**: tick "Send notifications for failed
   workflows only").

GitHub can run scheduled checks a few minutes late. For one-minute checks, a
free [UptimeRobot](https://uptimerobot.com) monitor on the same `/health/full`
address with email alerts to Jay works alongside it.

## When a customer's message fails mid-way

If the bot crashes while answering (for example the AI doesn't answer in
time), the server waits a second and tries once more when the failure looks
passing. Each WhatsApp send is also tried again (after 1 and 3 seconds) when
WhatsApp is busy or the connection drops. If it still fails, the customer gets:

> Sorry, something went wrong on our side and I couldn't finish answering.
> Please send your message again in a minute. If it keeps happening, the team
> has been alerted and will get back to you.

and Jay gets an error alert. A bot failure caused by a mistake in the code is
not retried (it would fail the same way), so a customer is never sent two
quotes.

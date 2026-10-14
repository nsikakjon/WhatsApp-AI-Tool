# Site progress reporter: setup

The site reporter answers its **own** WhatsApp number. The KahnPrints number
keeps running the quote bot; nothing about it changes.

For testing, use Meta's free test number (the one from Phase 0). A client's
real number can replace it later by changing one setting.

## 1. Create the tables (Supabase)

Supabase > SQL Editor > New query > paste the whole of
`supabase/migrations/0004_site_reporter.sql` > Run.

This also creates a private storage bucket called `site-photos`, where photos
from site are saved (Supabase > Storage).

Then do the same with `supabase/migrations/0013_site_locations_and_logo.sql`.
It lets the bot save location pins and each site's logo. (If you set the site
reporter up before October 2026, this is the only file you need to run now.)

## 2. Add a site and its team (Supabase)

In a new SQL query, change the names and numbers below, then Run. Numbers are
in international format with no + or spaces (e.g. 2348012345678).

```sql
with site as (
  insert into public.site_sites (name, address)
  values ('Test Site', 'Lekki, Lagos')
  returning id
)
insert into public.site_members (site_id, wa_id, name, role)
select site.id, m.wa_id, m.name, m.role
from site, (values
  ('2348000000001', 'Site Manager Name', 'manager'),
  ('2348000000002', 'Foreman Name',      'staff')
) as m(wa_id, name, role);
```

- **staff** send updates.
- **manager** also send updates, get the daily report, and can text `report`
  any time to get today's report so far.
- Each person belongs to one site for now.
- To remove someone, set `active` to false on their row in
  Table Editor > site_members.

## 3. Find the test number's Phone number ID (Meta)

Meta dashboard > your app > Use cases > Customize "Connect on WhatsApp" >
Step 1. Try it out. Pick the **test number** in the "From" list and copy its
**Phone number ID** (a long number, not the phone number itself).

While you're there, add every phone that will message the test number to the
"To" list (Manage phone number list). The test number only talks to numbers on
that list, up to 5.

## 4. Add the settings (Railway)

Service > Variables > add:

| Variable               | Value                                     |
| ---------------------- | ----------------------------------------- |
| `SITE_PHONE_NUMBER_ID` | the Phone number ID from step 3           |
| `SITE_REPORT_HOUR`     | `18` (6pm Lagos time), or another hour    |

`ANTHROPIC_API_KEY` is already set for the quote bot and is reused.
Railway redeploys by itself. The deploy log should say `site reporter: on`.

## 5. Test it

1. From a staff phone, send the test number a message ("Blockwork on first
   floor started"). Reply: `Logged for Test Site ✅`.
2. Send a few photos (with or without captions). You get one "Photo logged"
   reply per batch.
3. Send a voice note. The bot replies with what it heard.
4. Send a location pin: in the chat tap 📎 (or +) > Location > "Send your
   current location" or pick a place. Reply: `📍 Location logged for Test Site ✅`
   with the place name, or the coordinates if you didn't pick a named place.
5. From the manager phone, send your logo as a picture with the caption
   `logo`. Reply: `Logo saved ✅`. Only managers can do this; each site has one
   logo, and sending a new one replaces it.
6. From the manager phone, send `report`. You get today's report so far as a
   message, then the same report as a PDF: your logo at the top, the summary,
   the locations (tap "Open in Google Maps"), every update and the photos.
7. After the report hour, managers get the day's report automatically, also
   with the PDF.

If the PDF ever can't be made (for example a storage problem), the text report
still goes out on its own and the Railway log says `PDF report failed`.

## If something doesn't work

- **No reply at all**: Meta may not be sending the test number's messages to
  the server. Re-run `subscribed_apps` on the test WhatsApp Business Account
  (see the gotchas in `docs/META_SETUP.md`).
- **Railway log shows "WhatsApp send failed" with a permission error**: the
  access token can't use the test number. In Business settings > System users
  > whatsapp-bot > Assign assets, give it full control of the test WhatsApp
  Business Account, then try again (no new token needed).
- **The daily report doesn't arrive**: WhatsApp only delivers a bot's message
  if that person messaged the number in the last 24 hours. Managers who send
  their own updates or `report` during the day are fine. A WhatsApp message
  template will fix this for good later.

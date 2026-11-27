# Oko: farm and land app

A phone app for Jay at **`/farm/`** (for example `https://app.yarnoga.com/farm/`).
It's a personal tool for now, behind its own password. It can become a
public product later.

## What it does

**Crop fields:** cocoa, oil palm and cassava, plus plantain, maize and yam.
- **Growth stage** from the planting date: for example "Year 7 · Peak bearing"
  for cocoa, or "Month 7 · Root bulking, about 150 days to harvest" for cassava.
- **Weather** for each field: rain over the last 7 and 30 days, the 7-day
  forecast, temperature, humidity and soil moisture. It comes from
  Open-Meteo, which is free and needs no key.
- **What needs attention:** alerts worked out from the weather, the month and
  the crop's age. Examples: black pod risk when cocoa has had several wet,
  humid days; a water deficit for oil palm; green mite and mealybug in the
  dry season for cassava; heavy rain coming, so hold off spraying;
  harmattan fire risk.
- **Task calendar:** an automatic calendar for each crop (spray rounds,
  harvest rounds, weeding, fertiliser, pruning, fire breaks), timed for
  southern Nigeria's seasons. Tick tasks off and add your own.
- **Scouting walks:** a 1–5 health score, crop-specific problems to tick
  (e.g. black pod, mirids, Ganoderma, mosaic disease), counts and a photo.
  These build a health chart over time.
- **Records:** harvests and sales, plus costs (labour, fertiliser, chemicals and so on). The app shows
  the profit so far this year and the yield per hectare against typical
  yields.

**Land** (also a tab on every crop field):
- Walk the corners with GPS, or type the beacon coordinates from the survey
  plan (Minna datum or WGS84).
- Area (m², hectares, acres, number of 648 m² plots), bearings and distances, a setback line.
- **Drive-to pin:** opens Google Maps directions or Google Earth, or shares the
  location on WhatsApp. It points at the gate if you've marked one, otherwise the plot centre.
- Exports: a **DXF drawing** for AutoCAD/ArchiCAD, a printable site report, CSV,
  Google Earth KML and GeoJSON.

## Satellite crop health

Each field with a boundary gets a **Satellite crop health** card on its
Overview. It comes from the European Sentinel-2 satellites, which photograph
every field in Nigeria about every 5 days at 10 m detail.

- **Greenness (NDVI)** runs from about 0 (bare soil) to about 0.9 (dense,
  healthy canopy). Mature cocoa and oil palm usually read 0.65–0.85; young
  cassava reads much lower until its canopy closes.
- **The map** colours the field from brown (bare or stressed) to dark green.
  Grey squares were hidden by cloud. The **trend** shows every clear view in
  the last 12 months.
- If greenness drops by 0.1 or more against recent views, **What needs
  attention** says so and suggests walking the field.
- **Clouds:** southern Nigeria is cloudy for much of the rains. A date only
  counts when at least half the field could be seen, so there can be weeks
  without a new reading in June–October.
- The server asks the satellite service at most twice a day per field and
  keeps the answer, and the phone keeps the last answer for offline use.
- Demo farms show an invented example, marked **Sample**.

**Switching it on (free):**
1. Make an account at **dataspace.copernicus.eu**.
2. Open the **Dashboard**, then **User settings > OAuth clients > Create**. Name
   it "yarnOga farm", pick "Never expire", and copy the **client id** and
   **secret** (the secret is only shown once).
3. On Railway, add `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET`.
4. In Supabase, run `supabase/migrations/0077_farm_satellite.sql` (after 0076).

The free account comes with a monthly allowance of processing units, which
is plenty for a trial. Check usage on the Copernicus dashboard as testers join.

## WhatsApp alerts

A field's owner can get a WhatsApp message in the morning when the field
needs urgent attention, so they don't have to open the app to find out.

- **What's sent:** the same "What needs attention" alerts the app shows, but
  only the urgent ones: the red alerts (black pod risk, heavy rain coming,
  young cocoa under dry-season stress, over-mature cassava…) and the
  satellite showing the field less green. Season reminders and scouting
  nudges stay in the app. Never chemical rates: the alerts point to the
  label and the extension officer, like the app.
- **When:** the server checks every switched-on field once a day from 7am
  (Nigeria time), with fresh weather and satellite readings. Each field gets
  at most one message a day, and the same alert isn't sent again for a week.
- **Who gets it:** only the field's owner (not helpers, and not you as admin
  for other people's farms).
- **Switching it on (each person):** Settings > **WhatsApp alerts**: type
  your WhatsApp number (0803… is fine), tap **Save**, then switch alerts on
  for each field. Removing the number switches them all off.

**Switching it on (once, for the server):**
1. In Supabase, run `supabase/migrations/0078_farm_whatsapp_alerts.sql`
   (after 0076 and 0077).
2. WhatsApp only delivers a message from the bot to someone who hasn't
   messaged it in the last day if it's an approved **template**. The alerts
   use your owner-alert template (`OWNER_ALERT_TEMPLATE_NAME`, one value
   `{{1}}`) unless you set a separate one: in WhatsApp Manager, create a
   Utility template such as "Oko farm alert: {{1}}", and once Meta approves it
   put its name in `FARM_ALERT_TEMPLATE_NAME` on Railway.
3. On Railway, add `FARM_WHATSAPP_ALERTS` = `on`. The alerts come from
   yarnOga's main WhatsApp number.

To switch them off for everyone, delete `FARM_WHATSAPP_ALERTS`.

## Where the data lives

Each phone keeps its own working copy, so the app works with no signal on
the farm. When there's signal, it **syncs with yarnOga's database**
(Supabase). Fields are then safe if a phone is lost, and everyone on a farm
sees the same thing. Photos go to a private storage bucket and are only shown
to people on that farm.

If two people change the same field while offline, nothing is lost. Both
phones' scouting walks, harvests, costs and tasks are kept, and anything
either of them deleted stays deleted.

Demo farms stay on the phone that loaded them and never sync.

## Who can use it

- **You (admin):** open `https://app.yarnoga.com/farm/admin` once on each of
  your phones and type `FARM_PASSWORD` (any username). You can see every farm in
  the trial under **Testers' farms**, and invite testers from **Settings >
  Trial testers**.
- **Testers:** in **Settings > Trial testers**, type their name and tap
  **Invite**, then **Send on WhatsApp**. They tap the link, type their name and
  they're in. No password. Each link works once and expires after 14 days.
  The welcome screen tells them that you can see farms in the trial.
- **Helpers on a farm** (a manager or worker): the farm's owner opens the
  field, taps the pencil (edit) > **Invite a helper**, and sends that link.
  Helpers see and edit only that farm. The owner can remove them from the same
  place, and helpers can leave.
- **Switching someone off:** Settings > Trial testers > **Switch off** logs
  them out straight away.
- Anyone else who opens `/farm/` sees "Private trial" and can only look
  around with demo farms on their own phone.

## Switching it on

1. **Database:** Supabase > SQL Editor > New query > paste all of
   `supabase/migrations/0076_farm.sql` > **Run**. It adds the farm tables
   and a private `farm-photos` bucket. Running it again is safe.
2. **Password:** on Railway, open the service > **Variables** and add
   `FARM_PASSWORD` (at least 12 characters). This is your admin password.
3. Open `https://app.yarnoga.com/farm/admin` on your phone and type the
   password. Then add the app to your home screen: Chrome menu (⋮) >
   **Install app**, or Safari **Share > Add to Home Screen**.
4. Fields you made on that phone before logging in upload as yours on the
   first sync.

To switch the farm app off, delete `FARM_PASSWORD`. The saved data stays in
the database.

## Good to know

- Phone GPS is usually only accurate to within 3–10 m. That's fine for feasibility work and
  for finding the land. For design, type in the coordinates from the
  registered survey plan. The app isn't a legal survey.
- Crop advice is a planning guide based on common extension advice (CRIN,
  NIFOR, IITA). Chemical products and rates must follow the label and the
  local ADP / extension officer.
- Open-Meteo's free weather service is for non-commercial use. Before making
  Oko public, switch to their paid plan (or another provider). The satellite
  map uses Esri imagery, so check its terms before going public too.

## For a developer

- The app is plain HTML/CSS/JavaScript in `/farm-app` (no build step).
  `src/farm/index.ts` serves it behind the password. The manifest, icons and
  `sw.js` open without the password because phones fetch them without it.
- `farm-app/js/crops.js` holds the crop library: stages, yields, task rules,
  risk rules and scouting checklists. Change crop advice there.
- `farm-app/js/survey.js` and `geo.js` hold the land maths. These are UTM and Minna
  datum conversions, checked against the EPSG:26331 and EPSG:32631/32632 transforms.
- When you change any file in `/farm-app`, bump `C="oko-v1"` in
  `farm-app/sw.js` so phones pick up the new version.
- Sync: `farm-app/js/sync.js` (phone) and `src/farm/index.ts` (API under
  `/farm/api/`). `src/farm/merge.ts` holds the rules for combining two copies
  of a field. Logins are a random token in an `HttpOnly` cookie; only its hash
  is stored. Requests that change things must carry `X-Oko: 1` and come from
  the same site.
- Satellite: `src/farm/satellite.ts` calls the Copernicus Statistical and
  Process APIs (keys stay on the server); the phone side is `farm-app/js/satellite.js`.
- WhatsApp alerts: `src/farm/alerts.ts` runs the daily check. It doesn't
  copy the alert rules: `src/farm/rules.ts` runs `farm-app/js/crops.js`
  itself, so keep `crops.js` free of the page (no `document`/`window`).
  Weather is fetched the phone's way in `src/farm/weather.ts`.
- Ideas for the public version: an AI farm assistant using the existing
  Claude setup.

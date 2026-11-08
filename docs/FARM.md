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
  Open-Meteo through yarnOga's server, which keeps each answer for an hour
  and shares it between fields close together. The phone keeps the last
  answer, so it still shows with no signal.
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
- Open-Meteo's free weather service is for non-commercial use, and the
  satellite map uses Esri imagery. Both need sorting out before Oko goes
  public: see the launch checklist below.

## Launch checklist (private trial to public)

Work through this before anyone can use Oko without an invite.

**Weather (Open-Meteo)**
- [ ] Buy an Open-Meteo API plan at **open-meteo.com > Pricing** (the
  smallest plan covers far more than Oko needs, since the server shares one
  answer per ~1 km square per hour). Copy the API key.
- [ ] On Railway, add `OPEN_METEO_API_KEY` and redeploy. The start-up log
  then says `farm app: on (weather: Open-Meteo paid)`. Phones never see the key.
- [ ] Open a field on your phone and check the weather still loads.
- [ ] Keep the "Weather data by Open-Meteo.com (CC BY 4.0)" line in Settings.

**Satellite background map (Esri World Imagery)**
- [ ] The map loads Esri's imagery straight from `server.arcgisonline.com`
  with no account. That's fine for a trial, but a public app needs Esri's
  permission: make an **ArcGIS Location Platform** account (it has a free
  monthly allowance of map tiles), create an API key limited to the
  basemap service and the `app.yarnoga.com` address, and have a developer
  add the key to the map in `farm-app/js/app.js` (bump `sw.js` too).
- [ ] Or switch to another satellite map with clear commercial terms
  (for example Mapbox or MapTiler). Either way, keep the imagery credit on
  the map.

**Satellite crop health (Copernicus)**
- [ ] Sentinel-2 data itself is free for any use, commercial too. The limit
  is the Copernicus account's monthly allowance of **requests and
  processing units** (shown on the Copernicus dashboard; around 10,000
  requests a month at the time of writing).
- [ ] Each field that someone opens uses about 2 requests every 12 hours,
  so roughly 120 a month. That's room for about 80 busy fields. Check the
  dashboard each month as farms join; before you get near the limit, either
  apply for more through Copernicus or switch to a paid Sentinel Hub plan.
- [ ] The card already shows the last good reading if the service is
  refused, so nothing breaks, but readings stop updating.

**From trial to public access**
- [ ] Decide how people join: keep invite links, or add open sign-up
  (needs a developer: a sign-up screen and a limit on accounts per phone
  number or address).
- [ ] Rewrite the welcome screen. Today it tells testers that you can see
  every farm in the trial; a public app needs a short privacy notice
  (what is stored, who sees it, how to delete it) to meet the Nigeria Data
  Protection Act, and simple terms of use.
- [ ] Add a way for someone to delete their account and farms.
- [ ] Turn on Supabase backups (Point in Time Recovery or the daily backup
  on a paid plan) before real farms depend on it.
- [ ] Put a support contact (WhatsApp or email) in Settings.

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
- Weather: `src/farm/weather.ts` asks Open-Meteo (free, or paid with
  `OPEN_METEO_API_KEY`) and keeps answers in memory: forecasts for an hour,
  monthly rain for a day, one per ~1 km square. Phones call
  `/farm/api/weather` and `/farm/api/weather/monthly` (logged in only).
  Without a server (the preview) the phone asks Open-Meteo's free service
  itself.
- Satellite: `src/farm/satellite.ts` calls the Copernicus Statistical and
  Process APIs (keys stay on the server); the phone side is `farm-app/js/satellite.js`.
- Ideas for the public version: an AI farm assistant using the existing
  Claude setup, and WhatsApp alerts through the shared core.

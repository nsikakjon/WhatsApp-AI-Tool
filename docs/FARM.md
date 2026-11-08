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
- Ideas for the public version: satellite crop-health maps (Sentinel-2 NDVI),
  an AI farm assistant using the existing Claude setup, and WhatsApp alerts
  through the shared core.

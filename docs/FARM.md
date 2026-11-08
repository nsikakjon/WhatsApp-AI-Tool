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

On the phone (in the browser's storage), **not** on the server or in
Supabase. That keeps it private and lets it work offline on the farm. The
catch: clearing the browser's data or losing the phone loses it. Use
**Settings > Back up everything** now and then and keep the file somewhere
safe (Google Drive, email it to yourself).

## Switching it on

1. Pick a password of at least 12 characters.
2. On Railway, open the service > **Variables**, add `FARM_PASSWORD` with that
   password, and let it redeploy.
3. On your phone, open `https://app.yarnoga.com/farm/` in Chrome (Android) or
   Safari (iPhone). Type any username and the password.
4. Add it to the home screen: Chrome menu (⋮) > **Install app** / **Add to
   Home screen**, or Safari **Share > Add to Home Screen**.
5. Allow location when it asks (needed for GPS and the field weather).

To switch it off, delete `FARM_PASSWORD`.

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
- Ideas for the public version: save fields to Supabase per user, satellite
  crop-health maps (Sentinel-2 NDVI), an AI farm assistant using the existing
  Claude setup, and WhatsApp alerts through the shared core.

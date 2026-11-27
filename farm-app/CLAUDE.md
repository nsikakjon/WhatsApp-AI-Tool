# Oko: the farm and land app

Guidance for Claude (and any developer) working on Oko. Oko lives inside the
yarnOga repo but is its **own product**: it shares the server, Railway and
Supabase, and nothing else. The root `CLAUDE.md` rules still apply (secrets in
`.env`, money in kobo, small commits, plain explanations for Jay).

## What Oko is

A phone-first web app at `app.yarnoga.com/farm/` for:
- **Crop fields** in southern Nigeria (cocoa, oil palm, cassava, plantain,
  maize, yam): growth stage, field weather and alerts, an automatic task
  calendar, scouting walks, harvest/cost records, satellite crop health.
- **Land**: GPS or survey-plan beacons (Minna datum / WGS84), area, bearings,
  setback, DXF for architects, site report, KML/CSV/GeoJSON, a drive-to pin.

It's in a **private trial**: Jay (admin, `/farm/admin` with `FARM_PASSWORD`)
invites testers by link; field owners invite helpers. Public launch is
planned for late next year. The user-facing guide is `docs/FARM.md`.

## Where things are

| Path | What |
| --- | --- |
| `farm-app/index.html`, `css/app.css` | The page and its design (forest green `#163b27`, lime `#c8ec6f`, Inter) |
| `farm-app/js/geo.js` | UTM / Minna datum maths and number formatting (checked against EPSG:26331, 32631, 32632) |
| `farm-app/js/crops.js` | **Crop library**: stages, yields, task rules, risk alerts, scouting checklists, seasons. Crop advice changes go here |
| `farm-app/js/survey.js` | Land maths and exports (area, legs, setback, DXF, CSV, KML, GeoJSON, report) |
| `farm-app/js/sync.js` | Login by invite, background sync, photo upload, sharing, admin view (phone side) |
| `farm-app/js/satellite.js` | Satellite crop health card (phone side) |
| `farm-app/js/assistant.js` | Ask Oko chat sheet; builds the field summary the assistant sees (money as naira text) |
| `farm-app/js/app.js` | Screens, routing, sheets, weather (Open-Meteo), demo farms |
| `farm-app/sw.js` | Offline support. **Bump `C="oko-vN"` whenever any file in `farm-app/` changes**, or phones keep the old version |
| `src/farm/index.ts` | Serves the files and the API under `/farm/api/` |
| `src/farm/store.ts` | Database layer (Supabase + in-memory for tests) |
| `src/farm/assistant.ts` | AI farm assistant: system prompt, trimming what the phone sends, and `withoutRates` (strips any application rate from answers) |
| `src/farm/merge.ts` | How two phones' copies of a field are combined |
| `src/farm/satellite.ts` | Sentinel-2 NDVI from Copernicus (server side; keys never reach phones) |
| `supabase/migrations/0076_farm.sql`, `0077_farm_satellite.sql` | Oko's tables (`farm_*`) and the private `farm-photos` bucket |
| `scripts/preview-farm.ts` | Runs Oko locally with fake data: `npx tsx scripts/preview-farm.ts` |

## How it works (the parts that are easy to break)

- **No build step.** `farm-app/` is plain HTML/CSS/JS loaded as classic
  scripts in this order: geo, crops, survey, sync, satellite, assistant, app. They share
  globals (`fields`, `P`, `settings`, `route`, `render`, `touch`…). Keep it
  framework-free unless Jay agrees to a rewrite.
- **The phone is the working copy.** Everything is saved to IndexedDB first and
  works offline. `touch(p)` marks a field changed and schedules a sync;
  `saveLocal(p)` saves without syncing (use it for weather/satellite caches).
- **Deleting an item inside a field** (scouting, record, beacon, feature) must
  call `forget(p, id)` so the deletion survives syncing with other phones.
- **Phone-only keys** (`wx`, `sat`, `demo`, `_dirty`, `_ver`, `_synced`,
  `_owner`, `_role`…) are never sent; the list is in both `sync.js`
  (`strip`) and `merge.ts` (`LOCAL_ONLY`). Keep them in step.
- **Photos** never go inside field data: they upload to `/api/photos` first
  and are stored as `ph:<uuid>`; show them with `photoSrc()`.
- **Access**: every API route checks owner / helper / admin. Changing requests
  need the `X-Oko: 1` header and the same site.
- **Money** in records is kobo integers (`priceKobo`, `amountKobo`).
- **Demo farms** (`demo: true`) never sync. The claude.ai preview has no
  server, so the app must keep working with `Sync.mode === "local"`.
- Crop advice is a planning guide (CRIN, NIFOR, IITA). Never give chemical
  rates; point to the label and the ADP / extension officer. The assistant's
  prompt says so and `withoutRates` enforces it; keep both.

## Checking work

- `npx vitest run src/farm` for the server and merge logic; `npm run typecheck`.
- Look at the phone screens: run `npx tsx scripts/preview-farm.ts` and open it
  at a 390 px wide window, or screenshot with Playwright. Try with and without
  signal, and with two "phones" (two browser profiles) for sharing.
- A new table or column means a new numbered migration in
  `supabase/migrations/` and a line in `docs/FARM.md` telling Jay to run it.
- PRs go to `main` (not to another feature branch), one feature at a time.

## Ideas Jay has mentioned for later

Public launch next year (switch Open-Meteo to a paid plan, check Esri imagery
terms), WhatsApp alerts through the shared core, more testers in farms. The
AI farm assistant (Ask Oko) is built; it could later read scouting photos.

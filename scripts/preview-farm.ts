// Runs Oko (the farm and land app) on http://localhost:4646/farm/ with an
// in-memory database and a pretend satellite service, so it can be tried and
// changed without Supabase or Copernicus. Not used by the server.
//   npx tsx scripts/preview-farm.ts
// Admin login: http://localhost:4646/farm/admin (any username, password "preview-password").
// Data is lost when it stops.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createFarm } from "../src/farm/index.js";
import { memoryFarmStore } from "../src/farm/store.js";
import { createSatellite } from "../src/farm/satellite.js";
import { createFarmAssistant, type FarmAssistant } from "../src/farm/assistant.js";

const PORT = 4646;

// A pretend Copernicus: a gentle seasonal greenness curve, cloudy in the rains,
// and a plain green square as the field picture.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVR4XmPUqbL5z0ABYKJALxiMGjAaBqPpYLDkBQDhuQIBRrCdiAAAAABJRU5ErkJggg=="),
  (ch) => ch.charCodeAt(0),
);
const stat = (date: string, id: string, mean: number) => ({
  interval: { from: `${date}T00:00:00Z` },
  outputs: { [id]: { bands: { B0: { stats: { mean, min: mean - 0.1, max: mean + 0.1, sampleCount: 400, noDataCount: 0 } } } } },
});
const fakeCopernicus: typeof fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("token")) return new Response(JSON.stringify({ access_token: "preview", expires_in: 3600 }));
  if (u.endsWith("/statistics")) {
    const clear = String(JSON.parse(String(init?.body)).aggregation.evalscript).includes('id: "clear"');
    const data = [];
    for (let d = 360; d > 3; d -= 5) {
      const date = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
      const m = Number(date.slice(5, 7));
      const c = [6, 7, 9, 10].includes(m) ? 0.2 : 0.85;
      data.push(clear ? stat(date, "clear", c) : stat(date, "ndvi", 0.62 + 0.1 * Math.sin(d / 58)));
    }
    return new Response(JSON.stringify({ data }));
  }
  return new Response(PNG, { headers: { "content-type": "image/png" } });
};

// The farm assistant: real Claude when ANTHROPIC_API_KEY is set, otherwise a
// pretend one that shows what the phone sent, so the chat can be tried for free.
const pretendAssistant: FarmAssistant = {
  async ask({ question, context }) {
    const c = context as { field?: { crop?: string; stage?: string }; weather?: { rainLast7DaysMm?: number } | null; alerts?: string[] };
    await new Promise((r) => setTimeout(r, 600));
    return [
      `(Preview answer, no AI.) You asked: "${question}"`,
      `- Crop: ${c.field?.crop ?? "?"}, ${c.field?.stage ?? "no stage"}`,
      `- Rain last 7 days: ${c.weather?.rainLast7DaysMm ?? "?"} mm`,
      `- Alerts: ${c.alerts?.length ?? 0}`,
    ].join("\n");
  },
};
const assistant = process.env.ANTHROPIC_API_KEY
  ? createFarmAssistant({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5" })
  : pretendAssistant;

const app = new Hono();
app.get("/", (c) => c.redirect("/farm/"));
app.get("/farm", (c) => c.redirect("/farm/"));
app.route(
  "/farm",
  createFarm({
    password: "preview-password",
    store: memoryFarmStore(),
    satellite: createSatellite({ clientId: "preview", clientSecret: "preview" }, fakeCopernicus),
    assistant,
  }),
);
serve({ fetch: app.fetch, port: PORT });
console.log(`Oko preview: http://localhost:${PORT}/farm/  (admin: /farm/admin, password "preview-password")`);

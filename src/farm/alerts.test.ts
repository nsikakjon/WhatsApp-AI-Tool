import { describe, expect, it } from "vitest";
import { alertMessage, createFieldAlerts, waNumber } from "./alerts.js";
import { farmRules } from "./rules.js";
import { fieldLocation } from "./weather.js";
import { createFarm } from "./index.js";
import { memoryFarmStore } from "./store.js";

const DAY = 86400_000;
const quiet = { info() {}, error() {} };

/** Open-Meteo-shaped weather around `now`: `past` mm a day before today, `ahead` mm a day from today on. */
function weather(now: Date, past: number, ahead: number, rh = 90) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const time: string[] = [];
  for (let i = -31; i < 8; i++) time.push(new Date(today + i * DAY).toISOString().slice(0, 10));
  const rain = time.map((_, i) => (i < 31 ? past : ahead));
  return {
    current: { time: `${time[31]}T09:00`, temperature_2m: 26 },
    daily: {
      time,
      precipitation_sum: rain,
      temperature_2m_max: time.map(() => 30),
      temperature_2m_min: time.map(() => 22),
      et0_fao_evapotranspiration: time.map(() => 3),
    },
    rhDaily: time.map(() => rh),
    soil: 0.3,
  };
}

const cocoa = (extra: Record<string, unknown> = {}) => ({
  kind: "crop",
  f: { name: "Idanre cocoa", state: "Ondo" },
  crop: { id: "cocoa", planted: "2015-04-01" },
  beacons: [],
  scouts: [],
  ...extra,
});

// 10am in Lagos, in the rains.
const JUNE = new Date("2026-06-15T09:00:00Z");

describe("the app's alert rules on the server", () => {
  it("runs crops.js and gives the same alerts the phone shows, with their kind", () => {
    const rules = farmRules();
    const out = rules.insights(cocoa(), weather(JUNE, 10, 10), JUNE);
    expect(out[0]).toMatchObject({ level: "high", title: "Black pod risk is high", kind: "crop" });
    expect(out.find((i) => i.title === "Rain tomorrow")?.kind).toBe("weather");
    expect(out.find((i) => i.title === "No scouting yet")?.kind).toBe("scout");
    // Dry, less humid week: no black pod alarm, just the season note.
    expect(rules.insights(cocoa(), weather(JUNE, 0, 0, 60), JUNE).some((i) => i.level === "high")).toBe(false);
  });

  it("marks a satellite drop in greenness", () => {
    const series = [0.78, 0.8, 0.79, 0.62].map((mean, i) => ({ date: `2026-0${i + 2}-10`, mean, min: 0, max: 1, clear: 1 }));
    const out = farmRules().insights(cocoa({ sat: { series } }), null, JUNE);
    expect(out.find((i) => i.kind === "sat")?.title).toBe("Satellite: field looks less green");
  });

  it("finds the field's weather spot like the phone", () => {
    const states = farmRules().states;
    expect(fieldLocation({ beacons: [{ lat: 7, lon: 5 }, { lat: 7.2, lon: 5.2 }] }, states)).toEqual({ lat: 7.1, lon: 5.1 });
    expect(fieldLocation({ beacons: [], loc: { lat: 6.5, lon: 3.4 } }, states)).toEqual({ lat: 6.5, lon: 3.4 });
    expect(fieldLocation({ beacons: [], f: { state: "Ondo" } }, states)).toEqual({ lat: 7.25, lon: 5.19 });
    expect(fieldLocation({ beacons: [], f: {} }, states)).toBeNull();
  });
});

describe("WhatsApp numbers", () => {
  it("takes Nigerian numbers typed the local way or with +234", () => {
    expect(waNumber("0803 123 4567")).toBe("2348031234567");
    expect(waNumber("+234 803-123-4567")).toBe("2348031234567");
    expect(waNumber("2348031234567")).toBe("2348031234567");
    expect(waNumber("07011112222")).toBe("2347011112222");
  });
  it("takes other countries only with their code, and refuses junk", () => {
    expect(waNumber("+44 7700 900123")).toBe("447700900123");
    expect(waNumber("7700900123")).toBeNull();
    expect(waNumber("080312345")).toBeNull();
    expect(waNumber("+23480312345678")).toBeNull();
    expect(waNumber("call me")).toBeNull();
  });
});

async function setup(opts: { phone?: string | null; wx?: unknown; now?: Date } = {}) {
  const store = memoryFarmStore();
  const owner = await store.createUser("Ade", "tester");
  if (opts.phone !== null) await store.setPhone(owner.id, opts.phone ?? "2348031234567");
  await store.writeField("field001", owner.id, { id: "field001", ...cocoa() }, 0, owner.id);
  await store.setAlertSwitch("field001", true);
  const sent: Array<{ to: string; text: string }> = [];
  let clock = opts.now ?? JUNE;
  const alerts = createFieldAlerts({
    store,
    weather: async () => (opts.wx ?? weather(clock, 10, 10)) as never,
    send: async (to, text) => void sent.push({ to, text }),
    appUrl: "https://app.yarnoga.com/farm/",
    now: () => clock,
    log: quiet,
  });
  return { store, owner, sent, alerts, setClock: (d: Date) => (clock = d) };
}

describe("daily field alerts", () => {
  it("sends the owner the urgent alerts only, once", async () => {
    const { sent, alerts } = await setup();
    expect(await alerts.tick()).toEqual({ checked: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("2348031234567");
    expect(sent[0]!.text).toContain("Idanre cocoa needs attention");
    expect(sent[0]!.text).toContain("Black pod risk is high");
    // Season notes, light rain and scouting nudges stay in the app.
    expect(sent[0]!.text).not.toContain("Rain tomorrow");
    expect(sent[0]!.text).not.toContain("No scouting yet");
    expect(sent[0]!.text).toContain("https://app.yarnoga.com/farm/");
    // Never chemical rates: the rules point to the label instead.
    expect(sent[0]!.text).not.toMatch(/\d+\s*(ml|g|kg|l)\s*(per|\/)\s*(ha|litre|l)\b/i);
  });

  it("runs once a day, from 7am Nigeria time", async () => {
    const { sent, alerts, setClock } = await setup({ now: new Date("2026-06-15T05:30:00Z") }); // 6:30 in Lagos
    expect(await alerts.tick()).toBeNull();
    setClock(new Date("2026-06-15T06:05:00Z")); // 7:05
    expect(await alerts.tick()).not.toBeNull();
    expect(await alerts.tick()).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("doesn't repeat an alert within a week, but sends a new one", async () => {
    const { sent, alerts, setClock } = await setup();
    await alerts.tick();
    setClock(new Date(JUNE.getTime() + DAY));
    await alerts.tick();
    expect(sent).toHaveLength(1); // still black pod risk: already told them
    // Heavy rain forecast the next day: new, so it goes out on its own.
    const { sent: sent2, alerts: a2, store } = await setup({ wx: weather(JUNE, 10, 30) });
    await store.recordSentAlerts("field001", ["Black pod risk is high"], "2348031234567", JUNE);
    await a2.tick();
    expect(sent2).toHaveLength(1);
    expect(sent2[0]!.text).toContain("Heavy rain coming");
    expect(sent2[0]!.text).not.toContain("Black pod");
    // A week later the same alert can be sent again.
    setClock(new Date(JUNE.getTime() + 8 * DAY));
    await alerts.tick();
    expect(sent).toHaveLength(2);
  });

  it("skips fields that are off, owners without a number, and land", async () => {
    const off = await setup();
    await off.store.setAlertSwitch("field001", false);
    expect(await off.alerts.tick()).toEqual({ checked: 0, sent: 0 });
    const noPhone = await setup({ phone: null });
    await noPhone.alerts.tick();
    expect(noPhone.sent).toHaveLength(0);
    const land = await setup();
    const row = (await land.store.field("field001"))!;
    await land.store.writeField("field001", row.ownerId, { ...row.data, kind: "land", crop: null }, row.version, row.ownerId);
    await land.alerts.tick();
    expect(land.sent).toHaveLength(0);
  });

  it("still sends a satellite drop when the weather service is down", async () => {
    const { store, sent, alerts } = await setup();
    const series = [0.78, 0.8, 0.79, 0.62].map((mean, i) => ({ date: `2026-0${i + 2}-10`, mean, min: 0, max: 1, clear: 1 }));
    await store.saveSatellite("field001", { boundaryKey: "x", series, fetchedAt: JUNE, imageDate: null }, null);
    const broken = createFieldAlerts({
      store,
      weather: async () => { throw new Error("down"); },
      send: async (to, text) => void sent.push({ to, text }),
      now: () => JUNE,
      log: quiet,
    });
    await broken.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Satellite: field looks less green");
  });

  it("one field failing doesn't stop the others", async () => {
    const { store, owner, alerts, sent } = await setup();
    await store.writeField("field002", owner.id, { id: "field002", ...cocoa({ f: { name: "Second", state: "Ondo" } }) }, 0, owner.id);
    await store.setAlertSwitch("field002", true);
    const realSend = store.recordSentAlerts;
    let first = true;
    store.recordSentAlerts = async (...a) => {
      if (first) { first = false; throw new Error("database blip"); }
      return realSend(...a);
    };
    expect((await alerts.tick())?.checked).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it("writes a readable message", () => {
    const text = alertMessage("Farm A", [{ level: "high", title: "Heavy rain coming", text: "60 mm forecast.", kind: "weather" }]);
    expect(text.split("\n")[0]).toBe("🌱 Oko: Farm A needs attention");
    expect(text).toContain("• *Heavy rain coming*: 60 mm forecast.");
    expect(text).toContain("Settings > WhatsApp alerts");
  });
});

describe("alerts settings in the app", () => {
  const PASSWORD = "farm-password-123";
  function phone(app: ReturnType<typeof createFarm>) {
    let cookie = "";
    const req = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      if (init.method && init.method !== "GET") headers.set("x-oko", "1");
      if (init.json !== undefined) {
        headers.set("content-type", "application/json");
        init = { ...init, body: JSON.stringify(init.json) };
      }
      const res = await app.request(path, { ...init, headers });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return res;
    };
    return { req, json: async (path: string, init: RequestInit & { json?: unknown } = {}) => (await req(path, init)).json() as Promise<any> };
  }
  async function twoPeople(whatsappAlerts = true) {
    const store = memoryFarmStore();
    const app = createFarm({ password: PASSWORD, store, whatsappAlerts, log: quiet });
    const jay = phone(app);
    await jay.req("/admin", { headers: { authorization: `Basic ${btoa(`jay:${PASSWORD}`)}` } });
    const { url } = await jay.json("/api/invites", { method: "POST", json: { kind: "app" } });
    const ade = phone(app);
    await ade.json("/api/invites/accept", { method: "POST", json: { token: String(url).split("#invite=")[1], name: "Ade" } });
    await ade.req("/api/fields/adefield1", { method: "PUT", json: { data: { f: { name: "Ade's cocoa" }, kind: "crop", crop: { id: "cocoa" } } } });
    return { store, jay, ade };
  }

  it("is hidden when the server doesn't send alerts", async () => {
    const { ade } = await twoPeople(false);
    expect(await ade.json("/api/alerts")).toEqual({ available: false });
    expect((await ade.req("/api/alerts/phone", { method: "PUT", json: { phone: "08031234567" } })).status).toBe(503);
  });

  it("lets the owner save a number and switch a field on and off", async () => {
    const { ade, store } = await twoPeople();
    let s = await ade.json("/api/alerts");
    expect(s).toEqual({ available: true, phone: null, fields: [{ id: "adefield1", name: "Ade's cocoa", on: false }] });
    expect((await ade.req("/api/alerts/fields/adefield1", { method: "PUT", json: { on: true } })).status).toBe(400); // number first
    expect((await ade.req("/api/alerts/phone", { method: "PUT", json: { phone: "12345" } })).status).toBe(400);
    expect(await ade.json("/api/alerts/phone", { method: "PUT", json: { phone: "0803 123 4567" } })).toEqual({ phone: "2348031234567" });
    expect(await ade.json("/api/alerts/fields/adefield1", { method: "PUT", json: { on: true } })).toEqual({ id: "adefield1", on: true });
    expect(await store.alertFieldIds()).toEqual(["adefield1"]);
    s = await ade.json("/api/alerts");
    expect(s.fields[0].on).toBe(true);
    // Removing the number switches everything off.
    await ade.req("/api/alerts/phone", { method: "PUT", json: { phone: "" } });
    expect(await store.alertFieldIds()).toEqual([]);
  });

  it("only the owner can switch a field's alerts, even the admin can't for someone else", async () => {
    const { jay } = await twoPeople();
    await jay.req("/api/alerts/phone", { method: "PUT", json: { phone: "08031234567" } });
    expect((await jay.req("/api/alerts/fields/adefield1", { method: "PUT", json: { on: true } })).status).toBe(403);
    expect((await jay.json("/api/alerts")).fields).toEqual([]);
  });

  it("needs the app's header to change anything", async () => {
    const { store } = await twoPeople();
    const app = createFarm({ password: PASSWORD, store, whatsappAlerts: true, log: quiet });
    const res = await app.request("/api/alerts/phone", { method: "PUT", body: JSON.stringify({ phone: "08031234567" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(403);
  });
});

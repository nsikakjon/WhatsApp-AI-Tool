import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import { parseProgress, parseVisitForm, renderTally, summariseTally, type NewVisit, type Progress, type TallyStore, type Visit } from "./tally.js";
import { NOW, sampleStats } from "./testing.js";

function memoryStore(): TallyStore & { visits: Visit[] } {
  const visits: Visit[] = [];
  return {
    visits,
    async list() {
      return visits.map((v) => ({ ...v }));
    },
    async add(v: NewVisit) {
      visits.push({ ...v, id: visits.length + 1 });
    },
    async update(id: number, p: Progress) {
      Object.assign(visits.find((v) => v.id === id)!, p);
    },
    async remove(id: number) {
      visits.splice(visits.findIndex((v) => v.id === id), 1);
    },
  };
}

const visit = (id: number, date: string, extra: Partial<Visit> = {}): Visit => ({
  id,
  date,
  shop: `Shop ${id}`,
  type: null,
  place: null,
  notes: null,
  ownerIn: true,
  interested: false,
  signedUp: false,
  live: false,
  followUpOn: null,
  ...extra,
});

describe("tally sheet", () => {
  it("ticks the earlier steps when a later one is ticked", () => {
    expect(parseProgress({ live: "on" })).toEqual({ ownerIn: false, interested: true, signedUp: true, live: true, followUpOn: null });
    expect(parseProgress({ follow_up_on: "next week" })).toEqual({ problem: "Pick the follow-up day from the calendar." });
  });

  it("needs a shop name and a real day", () => {
    expect(parseVisitForm({ date: "2026-11-11", shop: " " })).toEqual({ problem: "Type the shop's name." });
    expect(parseVisitForm({ date: "soon", shop: "Ada" })).toEqual({ problem: "Pick the day you visited the shop." });
    expect(parseVisitForm({ date: "2026-11-11", shop: "Ada", type: "Boutique", owner_in: "on" })).toMatchObject({
      shop: "Ada",
      type: "Boutique",
      place: null,
      ownerIn: true,
    });
  });

  it("totals a day, lists every day and keeps follow-ups that aren't live", () => {
    const t = summariseTally(
      [
        visit(1, "2026-11-11", { interested: true, followUpOn: "2026-11-14" }),
        visit(2, "2026-11-11", { interested: true, signedUp: true, live: true, followUpOn: "2026-11-12" }),
        visit(3, "2026-11-11", { ownerIn: false, followUpOn: "2026-11-12" }),
        visit(4, "2026-11-12"),
      ],
      "2026-11-11",
    );
    expect(t.day).toEqual({ date: "2026-11-11", visited: 3, ownerIn: 2, interested: 2, signedUp: 1, live: 1 });
    expect(t.days.map((d) => d.date)).toEqual(["2026-11-12", "2026-11-11"]);
    expect(t.followUps.map((v) => v.id)).toEqual([3, 1]);
  });

  it("escapes what was typed", () => {
    const html = renderTally(summariseTally([visit(1, "2026-11-11", { shop: "<b>Ada</b>" })], "2026-11-11"), "2026-11-11", "2026-11-11");
    expect(html).not.toContain("<b>Ada</b>");
    expect(html).toContain("&#60;b&#62;Ada");
  });
});

describe("tally sheet pages", () => {
  const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: "app.example.com" };
  const post = (path: string, body: Record<string, string>, origin = "https://app.example.com") =>
    ({ method: "POST", headers: { ...auth, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }) as RequestInit;

  it("adds, updates and removes a shop, and only from the dashboard itself", async () => {
    const store = memoryStore();
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, tally: store, now: () => NOW });

    expect((await app.request("/tally", post("/tally", { date: "2026-10-16", shop: "Ada" }, "https://evil.example"))).status).toBe(403);

    const added = await app.request("/tally", post("/tally", { date: "2026-10-16", shop: "Ada Styles", place: "Admiralty Mall", interested: "on" }));
    expect(added.status).toBe(303);
    expect(added.headers.get("location")).toBe("/dashboard/tally?day=2026-10-16#day");
    expect(store.visits[0]).toMatchObject({ shop: "Ada Styles", interested: true, live: false });

    await app.request("/tally/1", post("/tally/1", { day: "2026-10-16", live: "on", owner_in: "on" }));
    expect(store.visits[0]).toMatchObject({ ownerIn: true, signedUp: true, live: true });

    const page = await (await app.request("/tally", { headers: auth })).text();
    expect(page).toContain("Ada Styles");
    expect(page).toContain("1 / 2");

    await app.request("/tally/1/delete", post("/tally/1/delete", { day: "2026-10-16" }));
    expect(store.visits).toHaveLength(0);
  });

  it("links the tally sheet from the dashboard", async () => {
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, tally: memoryStore(), now: () => NOW });
    expect(await (await app.request("/", { headers: auth })).text()).toContain('href="/dashboard/tally"');
  });
});

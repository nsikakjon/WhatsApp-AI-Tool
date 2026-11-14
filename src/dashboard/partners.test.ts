import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import { parsePartnerForm, renderPartners, summarisePartners, type NewPartner, type Partner, type PartnerStore } from "./partners.js";
import { NOW, sampleStats } from "./testing.js";

function memoryStore(): PartnerStore & { leads: Partner[] } {
  const leads: Partner[] = [];
  return {
    leads,
    async list() {
      return leads.map((p) => ({ ...p }));
    },
    async add(p: NewPartner) {
      leads.push({ ...p, id: leads.length + 1 });
    },
    async update(id: number, p: NewPartner) {
      Object.assign(leads.find((l) => l.id === id)!, p);
    },
    async remove(id: number) {
      leads.splice(leads.findIndex((l) => l.id === id), 1);
    },
  };
}

const lead = (id: number, extra: Partial<Partner> = {}): Partner => ({
  id,
  name: `Event ${id}`,
  kind: null,
  eventDate: null,
  place: null,
  contact: null,
  offer: null,
  status: "To contact",
  sentOn: null,
  followUpOn: null,
  link: null,
  notes: null,
  ...extra,
});

describe("partnerships list", () => {
  it("needs a name, a known status and real dates", () => {
    expect(parsePartnerForm({ name: " ", status: "Sent" }, "2026-11-14")).toEqual({ problem: "Type the event or organiser's name." });
    expect(parsePartnerForm({ name: "Fest", status: "Maybe" }, "2026-11-14")).toEqual({ problem: "Pick a status." });
    expect(parsePartnerForm({ name: "Fest", status: "Replied", event_date: "Dec" }, "2026-11-14")).toEqual({
      problem: "Pick the event day from the calendar.",
    });
    expect(parsePartnerForm({ name: "Fest", status: "Replied", link: "javascript:alert(1)" }, "2026-11-14")).toEqual({
      problem: "The link should start with https://",
    });
  });

  it("fills in the day sent and a follow-up when a lead is marked Sent", () => {
    expect(parsePartnerForm({ name: "Fest", status: "Sent" }, "2026-11-14")).toMatchObject({ sentOn: "2026-11-14", followUpOn: "2026-11-19" });
    expect(parsePartnerForm({ name: "Fest", status: "Sent", sent_on: "2026-11-10", follow_up_on: "2026-11-30" }, "2026-11-14")).toMatchObject({
      sentOn: "2026-11-10",
      followUpOn: "2026-11-30",
    });
    expect(parsePartnerForm({ name: "Fest", status: "To contact" }, "2026-11-14")).toMatchObject({ sentOn: null, followUpOn: null });
  });

  it("counts statuses and lists open follow-ups soonest first", () => {
    const s = summarisePartners([
      lead(1, { status: "Sent", followUpOn: "2026-11-20" }),
      lead(2, { status: "Agreed", followUpOn: "2026-11-15" }),
      lead(3, { status: "Replied", followUpOn: "2026-11-16" }),
      lead(4, { eventDate: "2026-12-01" }),
    ]);
    expect(s.counts).toMatchObject({ Sent: 1, Agreed: 1, Replied: 1, "To contact": 1 });
    expect(s.followUps.map((p) => p.id)).toEqual([3, 1]);
    expect(s.all.at(-1)!.id).toBe(2);
  });

  it("escapes what was typed", () => {
    const html = renderPartners(summarisePartners([lead(1, { name: "<b>Fest</b>" })]), "2026-11-14");
    expect(html).not.toContain("<b>Fest</b>");
    expect(html).toContain("&#60;b&#62;Fest");
  });
});

describe("partnerships pages", () => {
  const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: "app.example.com" };
  const post = (body: Record<string, string>, origin = "https://app.example.com") =>
    ({ method: "POST", headers: { ...auth, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }) as RequestInit;

  it("adds, changes and removes a lead, and only from the dashboard itself", async () => {
    const store = memoryStore();
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, partners: store, now: () => NOW });

    expect((await app.request("/partners", post({ name: "Fest", status: "Sent" }, "https://evil.example"))).status).toBe(403);

    const added = await app.request("/partners", post({ name: "Food Fest", status: "To contact", contact: "info@fest.example" }));
    expect(added.status).toBe(303);
    expect(added.headers.get("location")).toBe("/dashboard/partners#list");
    expect(store.leads[0]).toMatchObject({ name: "Food Fest", status: "To contact" });

    await app.request("/partners/1", post({ name: "Food Fest", status: "Sent", sent_on: "2026-10-16", contact: "info@fest.example" }));
    expect(store.leads[0]).toMatchObject({ status: "Sent", sentOn: "2026-10-16", followUpOn: "2026-10-21" });

    const page = await (await app.request("/partners", { headers: auth })).text();
    expect(page).toContain("Food Fest");
    expect(page).toContain("info@fest.example");

    const edit = await (await app.request("/partners?edit=1", { headers: auth })).text();
    expect(edit).toContain('action="/dashboard/partners/1"');

    await app.request("/partners/1/delete", post({}));
    expect(store.leads).toHaveLength(0);
  });

  it("links the partnerships list from the dashboard", async () => {
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, partners: memoryStore(), now: () => NOW });
    expect(await (await app.request("/", { headers: auth })).text()).toContain('href="/dashboard/partners"');
  });
});

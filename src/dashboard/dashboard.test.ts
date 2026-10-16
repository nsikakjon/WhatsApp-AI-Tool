import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import { renderDashboard } from "./page.js";
import { effectivePlan, lagosDays, summariseFlyerPlans, summariseOrders, type DashboardStats } from "./stats.js";

const NOW = new Date("2026-10-16T08:00:00Z");

function sampleStats(): DashboardStats {
  return {
    generatedAt: NOW,
    whatsapp: {
      contacts: 42,
      newContacts7: 5,
      newContacts30: 12,
      inbound7: 70,
      inbound30: 300,
      outbound30: 310,
      voiceNotes30: 9,
      dailyInbound: lagosDays(NOW, 30).map((d, i) => ({ date: d.date, count: i % 4 })),
    },
    flyers: summariseFlyerPlans(
      { groups: 3, newGroups30: 2, members: 55, birthdayFlyersAll: 20, birthdayFlyers30: 6 },
      [
        { plan: "free", plan_until: null },
        { plan: "standard", plan_until: "2026-12-01T00:00:00Z" },
        { plan: "organisation", plan_until: null },
      ],
      [
        { id: "free", monthly_price_kobo: 0, sort_order: 0 },
        { id: "standard", monthly_price_kobo: 450000, sort_order: 1 },
        { id: "organisation", monthly_price_kobo: null, sort_order: 4 },
      ],
      NOW,
    ),
    quotes: summariseOrders([{ status: "paid", total_kobo: 1250000, paid_at: "2026-10-10T00:00:00Z" }], NOW),
    site: { sites: 1, members: 4, updates7: 8, updates30: 30, photos30: 12, voiceNotes30: 3, reports30: 14 },
    leads: { total: 7, new30: 3, hot: 1, warm: 2, cold: 4, handedOff: 1 },
  };
}

describe("lagosDays", () => {
  it("starts each day at Lagos midnight and ends on today", () => {
    const days = lagosDays(new Date("2026-10-15T23:30:00Z"), 2); // 00:30 on the 16th in Lagos
    expect(days.map((d) => d.date)).toEqual(["2026-10-15", "2026-10-16"]);
    expect(days[1].start.toISOString()).toBe("2026-10-15T23:00:00.000Z");
  });
});

describe("effectivePlan", () => {
  it("treats a paid plan past its end date as Free", () => {
    expect(effectivePlan("premium", "2026-10-01T00:00:00Z", NOW)).toBe("free");
    expect(effectivePlan("premium", "2026-11-01T00:00:00Z", NOW)).toBe("premium");
    expect(effectivePlan("premium", null, NOW)).toBe("premium");
  });
});

describe("summaries", () => {
  it("values paid flyer plans at list price and sets aside on-request plans", () => {
    const f = sampleStats().flyers;
    expect(f.paidGroups).toBe(2);
    expect(f.planValueKobo).toBe(450000);
    expect(f.groupsOnRequestPrice).toBe(1);
  });

  it("only counts orders marked paid as sales", () => {
    const q = summariseOrders(
      [
        { status: "paid", total_kobo: 1000000, paid_at: "2026-10-10T00:00:00Z" },
        { status: "paid", total_kobo: 500000, paid_at: "2026-08-01T00:00:00Z" },
        { status: "confirmed", total_kobo: 300000, paid_at: null },
        { status: "quoted", total_kobo: 999999, paid_at: null },
      ],
      NOW,
    );
    expect(q).toMatchObject({ paid: 2, paidKobo: 1500000, paid30Kobo: 1000000, confirmed: 1, awaitingPaymentKobo: 300000, quoted: 1 });
  });
});

describe("dashboard page", () => {
  const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, now: () => NOW });

  it("asks for a password", async () => {
    expect((await app.request("/")).status).toBe(401);
    const wrong = await app.request("/", { headers: { Authorization: `Basic ${btoa("jay:nope")}` } });
    expect(wrong.status).toBe(401);
  });

  it("shows live numbers with the right password", async () => {
    const res = await app.request("/", { headers: { Authorization: `Basic ${btoa("jay:secret")}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("yarn<b>Oga</b> dashboard");
    expect(html).toContain("₦12,500");
    expect(html).toContain("₦4,500/mo");
    expect(html).toContain("Not connected");
  });

  it("escapes text so nothing from the database can inject HTML", () => {
    const stats = sampleStats();
    stats.flyers.plans.push({ id: "<script>", groups: 0, monthlyPriceKobo: 0 });
    expect(renderDashboard(stats)).not.toContain("<script>");
  });
});

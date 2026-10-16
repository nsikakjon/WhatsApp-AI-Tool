import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import { renderDashboard } from "./page.js";
import { effectivePlan, lagosDays, summariseOrders } from "./stats.js";
import { NOW, sampleStats } from "./testing.js";

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
  });

  it("sends the owner to TikTok to connect, and rejects a callback it didn't start", async () => {
    const tiktokApp = createDashboard({
      password: "secret",
      stats: { load: async () => sampleStats() },
      tiktokApp: { clientKey: "ck", clientSecret: "cs" },
    });
    const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: "x.up.railway.app" };
    const go = await tiktokApp.request("/tiktok/connect", { headers: auth });
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toContain("tiktok.com/v2/auth/authorize");
    const forged = await tiktokApp.request("/tiktok/callback?code=x&state=made-up", { headers: auth });
    expect(forged.status).toBe(400);
  });

  it("escapes text so nothing from the database can inject HTML", () => {
    const stats = sampleStats();
    stats.flyers.plans.push({ id: "<script>", groups: 0, monthlyPriceKobo: 0 });
    expect(renderDashboard(stats)).not.toContain("<script>");
  });
});

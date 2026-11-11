import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import { renderDashboard } from "./page.js";
import { effectivePlan, lagosDays, lagosMonth, summariseOrders, summariseSent } from "./stats.js";
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

describe("messages sent per number", () => {
  it("names each number, adds unlabelled messages to the main number, and marks who Meta bills", () => {
    const rows = summariseSent(
      [
        { business_number_id: "main", sent: 600 },
        { business_number_id: "", sent: 50 },
        { business_number_id: "ada", sent: 900 },
        { business_number_id: "own", sent: 20 },
        { business_number_id: "mystery", sent: 1 },
      ],
      [{ id: "main", label: "Sales" }],
      [{ phone_number_id: "ada", name: "Ada Prints" }],
      [{ phone_number_id: "own", verified_name: "Bola Bakes" }],
    );
    expect(rows).toEqual([
      { label: "Ada Prints", sent: 900, ownAccount: false },
      { label: "Sales", sent: 650, ownAccount: false },
      { label: "Bola Bakes", sent: 20, ownAccount: true },
      { label: "Number mystery", sent: 1, ownAccount: false },
    ]);
  });

  it("uses the Lagos month", () => {
    expect(lagosMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
    expect(lagosMonth(NOW)).toBe("2026-10-01");
  });

  it("shows how far past Meta's free 1,000 each number is, or asks for the migration", () => {
    const html = renderDashboard(sampleStats(), { tab: "products" });
    expect(html).toContain("<td>Flyers</td><td>1,240</td><td>240</td><td>yarnOga</td>");
    expect(html).toContain("<td>Ada Prints</td><td>300</td><td>0</td><td>The business</td>");
    const before = sampleStats();
    before.whatsapp.sentThisMonth = null;
    expect(renderDashboard(before, { tab: "products" })).toContain("once migration 0043 is run");
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
    const res = await app.request("/?tab=products", { headers: { Authorization: `Basic ${btoa("jay:secret")}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("yarn<b>Oga</b> analytics");
    expect(html).toContain('href="/dashboard?tab=products" aria-current="page"');
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
    expect(renderDashboard(stats, { tab: "products" })).not.toContain("<script>");
  });
});

describe("leads from ads", () => {
  const ad = {
    numberId: "PN1",
    label: "Demo Shop",
    sourceType: "ad",
    sourceId: "1202",
    headline: "Prices <on> WhatsApp",
    sourceUrl: "https://fb.me/x",
    leads: 9,
    leads7: 4,
    leads30: 7,
    freeNow: 2,
    lastAt: NOW,
    firstBy: new Map<string, Date>(),
  };

  it("lists each ad with its leads and who's in a free window", () => {
    const html = renderDashboard(sampleStats(), { tab: "marketing", ads: { ads: [ad], freeSentThisMonth: 31 } });
    expect(html).toContain('id="ads"');
    expect(html).toContain("Prices &#60;on&#62; WhatsApp");
    expect(html).toContain("<td>Demo Shop</td><td>4</td><td>7</td><td>9</td><td>2</td>");
    expect(html).toContain(">31<");
  });

  it("says when there are no leads yet, and hides the section when it's off", () => {
    expect(renderDashboard(sampleStats(), { tab: "marketing", ads: { ads: [], freeSentThisMonth: 0 } })).toContain("No one has messaged from an ad yet");
    expect(renderDashboard(sampleStats(), { tab: "marketing" })).not.toContain('id="ads"');
  });
});

describe("dashboard tabs", () => {
  it("opens on an overview that flags shops losing money and lists the tools", () => {
    const losing = { name: "Ada Styles", plan: "Free", paysKobo: 0, aiReplies: 1, voiceNotes: 0, voiceMinutes: 0, sent: 1, cost: { aiKobo: 1, voiceKobo: 0, metaKobo: 0, totalKobo: 1 }, projectedKobo: 9, losing: true };
    const html = renderDashboard(sampleStats(), {
      costs: { month: "2026-10-01", usdRateKobo: 137000, shops: [losing], plans: [], otherNumbers: [] },
      tallySheet: true,
    });
    expect(html).toContain("Ada Styles will cost more than it pays this month");
    expect(html).toContain('class="tool" href="/dashboard/tally"');
    expect(html).not.toContain('id="whatsapp"');
  });

  it("says when nothing needs a look, and falls back to the overview for an unknown tab", async () => {
    expect(renderDashboard(sampleStats())).toContain("Nothing needs you right now");
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, now: () => NOW });
    const html = await (await app.request("/?tab=nope", { headers: { Authorization: `Basic ${btoa("jay:secret")}` } })).text();
    expect(html).toContain('href="/dashboard" aria-current="page"');
  });
});

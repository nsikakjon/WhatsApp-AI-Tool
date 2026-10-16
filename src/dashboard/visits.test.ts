import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import { renderDashboard } from "./page.js";
import { NOW, sampleStats } from "./testing.js";
import { cleanPath, createVisitCounter, referrerHost, summariseVisitDays, visitorCode, type SiteVisit } from "./visits.js";

const BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";

function counter() {
  const visits: SiteVisit[] = [];
  const app = createVisitCounter({
    store: { record: async (v) => void visits.push(v) },
    secret: "s3cret",
    now: () => NOW,
  });
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    app.request("/", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        Origin: "https://yarnoga.com",
        "User-Agent": BROWSER,
        "X-Forwarded-For": "102.89.1.2, 10.0.0.1",
        ...headers,
      },
    });
  return { app, visits, send };
}

describe("visitor counter", () => {
  it("records a page view from yarnoga.com without keeping the IP", async () => {
    const { visits, send } = counter();
    const res = await send({ p: "/flyers.html?ref=ig", r: "https://www.google.com/search?q=flyers" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://yarnoga.com");
    expect(visits).toEqual([
      {
        day: "2026-10-16",
        path: "/flyers.html",
        referrerHost: "www.google.com",
        visitor: visitorCode("s3cret", "2026-10-16", "102.89.1.2", BROWSER),
      },
    ]);
    expect(JSON.stringify(visits)).not.toContain("102.89");
  });

  it("gives the same person the same code within a day, and a new one the next day", () => {
    const today = visitorCode("k", "2026-10-16", "1.2.3.4", BROWSER);
    expect(visitorCode("k", "2026-10-16", "1.2.3.4", BROWSER)).toBe(today);
    expect(visitorCode("k", "2026-10-17", "1.2.3.4", BROWSER)).not.toBe(today);
    expect(visitorCode("k", "2026-10-16", "1.2.3.5", BROWSER)).not.toBe(today);
  });

  it("ignores other websites, bots, link previews and junk", async () => {
    const { visits, send } = counter();
    await send({ p: "/" }, { Origin: "https://someone-else.com" });
    await send({ p: "/" }, { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" });
    await send({ p: "/" }, { "User-Agent": "WhatsApp/2.23.20.0 A" });
    await send({ p: "/" }, { "User-Agent": "" });
    await send("not json");
    await send({ p: "https://evil.example/" });
    await send({ p: "/" + "x".repeat(3000) });
    expect(visits).toEqual([]);
  });

  it("answers the browser's permission check only for yarnoga.com", async () => {
    const { app } = counter();
    const ok = await app.request("/", { method: "OPTIONS", headers: { Origin: "https://www.yarnoga.com" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://www.yarnoga.com");
    const no = await app.request("/", { method: "OPTIONS", headers: { Origin: "https://x.com" } });
    expect(no.status).toBe(403);
  });

  it("still answers when the database is down", async () => {
    const app = createVisitCounter({
      store: { record: async () => Promise.reject(new Error("down")) },
      secret: "k",
      log: { error: () => {} },
    });
    const res = await app.request("/", {
      method: "POST",
      body: JSON.stringify({ p: "/" }),
      headers: { Origin: "https://yarnoga.com", "User-Agent": BROWSER },
    });
    expect(res.status).toBe(204);
  });
});

describe("cleaning what the page sends", () => {
  it("keeps only the page path", () => {
    expect(cleanPath("/index.html")).toBe("/");
    expect(cleanPath("/blog/index.html")).toBe("/blog/");
    expect(cleanPath("/quotes.html#pricing")).toBe("/quotes.html");
    expect(cleanPath("flyers.html")).toBeNull();
    expect(cleanPath(42)).toBeNull();
  });

  it("keeps only the site a visitor came from, not clicks inside yarnoga.com", () => {
    expect(referrerHost("https://l.instagram.com/?u=abc")).toBe("l.instagram.com");
    expect(referrerHost("https://www.yarnoga.com/blog.html")).toBeNull();
    expect(referrerHost("")).toBeNull();
    expect(referrerHost("nonsense")).toBeNull();
  });
});

describe("website numbers on the dashboard", () => {
  const days = [
    { day: "2026-10-16", views: 12, visitors: 5 },
    { day: "2026-10-12", views: 8, visitors: 3 },
    { day: "2026-09-20", views: 4, visitors: 2 },
  ];

  it("adds up today, this week and the last 30 days", () => {
    const s = summariseVisitDays(days, NOW);
    expect(s).toMatchObject({ viewsToday: 12, visitorsToday: 5, views7: 20, views30: 24 });
    expect(s.daily).toHaveLength(30);
  });

  it("shows visitors, top pages and where they came from", () => {
    const html = renderDashboard(sampleStats(), [], {
      ...summariseVisitDays(days, NOW),
      topPages: [{ path: "/flyers.html", views: 9 }],
      topSources: [{ source: "", views: 6 }, { source: "www.google.com", views: 3 }],
    });
    expect(html).toContain("Website (yarnoga.com)");
    expect(html).toContain("/flyers.html");
    expect(html).toContain("Direct (typed, bookmark or an app)");
    expect(html).toContain("www.google.com");
  });

  it("keeps the rest of the dashboard working if the visit numbers can't load", async () => {
    const app = createDashboard({
      password: "secret",
      stats: { load: async () => sampleStats() },
      website: { load: async () => Promise.reject(new Error('relation "site_visit_days" does not exist')) },
      now: () => NOW,
      log: { error: () => {} },
    });
    const res = await app.request("/", { headers: { Authorization: `Basic ${btoa("jay:secret")}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("0016_site_visits.sql");
    expect(html).toContain("₦12,500");
  });
});

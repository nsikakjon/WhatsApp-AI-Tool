import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAnalytics } from "./analytics.js";
import { renderDashboard } from "./page.js";
import { sampleStats } from "./testing.js";

const NOW = new Date("2026-11-14T21:00:00Z");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = JSON.stringify({
  client_email: "dashboard@yarnoga-dashboard.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});

const row = (dims: string[], ...metrics: number[]) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: metrics.map((m) => ({ value: String(m) })),
});

const REPORTS = {
  reports: [
    { rows: [row([], 420, 300, 610, 1500)] },
    { rows: [row([], 120)] },
    { rows: [row(["20261113"], 30), row(["20261114"], 12)] },
    { rows: [row(["/"], 900), row(["/flyers.html"], 250)] },
    { rows: [row(["Organic Search", "google"], 300), row(["Direct", "(direct)"], 200)] },
  ],
};

function fakeFetch(report: { body: unknown; status?: number }, calls: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = url.includes("oauth2") ? { access_token: "AT", expires_in: 3600 } : report.body;
    return new Response(JSON.stringify(body), { status: url.includes("oauth2") ? 200 : (report.status ?? 200) });
  }) as typeof fetch;
}

describe("Google Analytics", () => {
  it("is not connected until both values are set", async () => {
    expect(await createAnalytics({ propertyId: "123", fetch: fakeFetch({ body: {} }) }).load(NOW)).toEqual({ status: "not_connected" });
  });

  it("signs in with the service account and reads the reports", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const result = await createAnalytics({ propertyId: "properties/123", serviceAccountKey: KEY, fetch: fakeFetch({ body: REPORTS }, calls) }).load(NOW);

    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0]!.init?.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(calls[1]!.url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123:batchRunReports");
    expect((calls[1]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer AT");

    if (result.status !== "live") throw new Error(JSON.stringify(result));
    const r = result.report;
    expect([r.users30, r.newUsers30, r.sessions30, r.views30, r.users7]).toEqual([420, 300, 610, 1500, 120]);
    expect(r.daily).toHaveLength(30);
    expect(r.daily.slice(-2)).toEqual([
      { date: "2026-11-13", users: 30 },
      { date: "2026-11-14", users: 12 },
    ]);
    expect(r.topPages).toEqual([
      { label: "/", count: 900 },
      { label: "/flyers.html", count: 250 },
    ]);
    expect(r.sources).toEqual([
      { label: "Organic Search: google", count: 300 },
      { label: "Direct", count: 200 },
    ]);
  });

  it("explains a missing Viewer permission", async () => {
    const result = await createAnalytics({
      propertyId: "123",
      serviceAccountKey: KEY,
      fetch: fakeFetch({ body: { error: { message: "User does not have sufficient permissions for this property." } }, status: 403 }),
    }).load(NOW);
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.problem).toContain("add dashboard@yarnoga-dashboard.iam.gserviceaccount.com as a Viewer");
  });

  it("says when the key isn't the JSON file", async () => {
    const result = await createAnalytics({ propertyId: "123", serviceAccountKey: "abc", fetch: fakeFetch({ body: {} }) }).load(NOW);
    expect(result.status === "error" && result.problem).toContain("isn't the full JSON key file");
  });

  it("shows on the Marketing tab and flags a failure on the overview", async () => {
    const live = await createAnalytics({ propertyId: "123", serviceAccountKey: KEY, fetch: fakeFetch({ body: REPORTS }) }).load(NOW);
    const page = renderDashboard(sampleStats(), { tab: "marketing", analytics: live });
    expect(page).toContain("Google Analytics (yarnoga.com)");
    expect(page).toContain("Organic Search: google");
    expect(page).toContain("<th>Sessions</th>");

    const overview = renderDashboard(sampleStats(), { analytics: { status: "error", problem: "x" } });
    expect(overview).toContain("Google Analytics couldn&#39;t load");
  });
});

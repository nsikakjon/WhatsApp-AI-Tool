import { describe, expect, it } from "vitest";
import { renderDashboard } from "./page.js";
import { createSocials } from "./socials.js";
import { sampleStats } from "./testing.js";
import { tiktokAuthorizeUrl } from "./tiktok.js";

const NOW = new Date("2026-10-16T08:00:00Z");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A pretend internet: answers each request by the first matching URL piece. */
function fakeFetch(routes: [string, unknown, number?][], calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [part, body, status] of routes) if (url.includes(part)) return json(body, status);
    return json({ error: { message: `no route for ${url}` } }, 404);
  }) as typeof fetch;
}

describe("socials", () => {
  it("shows every account as not connected when no keys are set", async () => {
    const accounts = await createSocials({ fetch: fakeFetch([]) }).load(NOW);
    expect(accounts.map((a) => [a.name, a.status])).toEqual([
      ["Instagram", "not_connected"],
      ["Facebook", "not_connected"],
      ["TikTok", "not_connected"],
      ["YouTube", "not_connected"],
      ["Website", "not_connected"],
    ]);
  });

  it("reads Instagram, Facebook, YouTube and TikTok numbers", async () => {
    const socials = createSocials({
      meta: { token: "SYS", pageId: "123", graphApiVersion: "v23.0" },
      youtube: { apiKey: "YTKEY", handle: "yarnoga" },
      tiktok: { clientKey: "ck", clientSecret: "cs", refreshToken: "rt" },
      fetch: fakeFetch([
        ["/123?", { access_token: "PAGE", followers_count: 210, fan_count: 190, instagram_business_account: { id: "IG1" } }],
        ["/IG1/insights", { data: [{ name: "reach", total_value: { value: 5400 } }, { name: "accounts_engaged", total_value: { value: 320 } }] }],
        ["/IG1?", { followers_count: 860, media_count: 42 }],
        ["googleapis.com/youtube", { items: [{ statistics: { subscriberCount: "75", viewCount: "9100", videoCount: "12" } }] }],
        ["oauth/token", { access_token: "AT", refresh_token: "rt" }],
        ["user/info", { data: { user: { follower_count: 1500, following_count: 3, likes_count: 22000, video_count: 30 } }, error: { code: "ok" } }],
      ]),
    });
    const [ig, fb, tt, yt] = await socials.load(NOW);
    expect(ig.status).toBe("live");
    expect(ig.stats.map((s) => [s.label, s.value])).toEqual([
      ["Followers", 860],
      ["Posts", 42],
      ["Accounts reached", 5400],
      ["Accounts engaged", 320],
    ]);
    expect(fb.stats.map((s) => s.value)).toEqual([210, 190]);
    expect(tt.stats.map((s) => [s.label, s.value])).toEqual([
      ["Followers", 1500],
      ["Likes", 22000],
      ["Videos", 30],
    ]);
    expect(yt.stats.map((s) => s.value)).toEqual([75, 9100, 12]);
  });

  it("explains a failure without showing the key", async () => {
    const socials = createSocials({
      youtube: { apiKey: "SECRETKEY", handle: "yarnoga" },
      fetch: fakeFetch([["googleapis", { error: { message: "API key SECRETKEY not valid" } }, 400]]),
    });
    const yt = (await socials.load(NOW)).find((a) => a.name === "YouTube")!;
    expect(yt.status).toBe("error");
    expect(yt.problem).toContain("not valid");
    expect(yt.problem).not.toContain("SECRETKEY");
  });

  it("still shows Instagram followers when reach numbers are refused", async () => {
    const socials = createSocials({
      meta: { token: "SYS", pageId: "123", graphApiVersion: "v23.0" },
      fetch: fakeFetch([
        ["/123?", { followers_count: 1, fan_count: 1, instagram_business_account: { id: "IG1" } }],
        ["/IG1/insights", { error: { message: "missing permission" } }, 403],
        ["/IG1?", { followers_count: 860, media_count: 42 }],
      ]),
    });
    const [ig] = await socials.load(NOW);
    expect(ig.status).toBe("live");
    expect(ig.stats).toHaveLength(2);
    expect(ig.problem).toContain("missing permission");
  });

  it("asks for the TikTok sign-in when the app keys are set but not connected", async () => {
    const tt = (await createSocials({ tiktok: { clientKey: "ck", clientSecret: "cs" }, fetch: fakeFetch([]) }).load(NOW))[2];
    expect(tt.status).toBe("not_connected");
    expect(tt.needs).toContain("/dashboard/tiktok/connect");
  });

  it("asks the platforms again only after the cache runs out", async () => {
    const calls: string[] = [];
    const socials = createSocials({
      youtube: { apiKey: "k", handle: "yarnoga" },
      fetch: fakeFetch([["googleapis", { items: [{ statistics: { viewCount: "1", videoCount: "1" } }] }]], calls),
      cacheMs: 60_000,
    });
    await socials.load(NOW);
    await socials.load(new Date(NOW.getTime() + 30_000));
    expect(calls).toHaveLength(1);
    await socials.load(new Date(NOW.getTime() + 61_000));
    expect(calls).toHaveLength(2);
  });

  it("puts live numbers and not-connected notes on the page", async () => {
    const accounts = await createSocials({
      youtube: { apiKey: "k", handle: "yarnoga" },
      fetch: fakeFetch([["googleapis", { items: [{ statistics: { subscriberCount: "75", viewCount: "9100", videoCount: "12" } }] }]]),
    }).load(NOW);
    const html = renderDashboard(sampleStats(), accounts);
    expect(html).toContain("<b>9,100</b> Total views");
    expect(html).toContain("Not connected");
  });
});

describe("TikTok sign-in link", () => {
  it("asks for the account numbers permission and returns to our callback", () => {
    const url = new URL(tiktokAuthorizeUrl({ clientKey: "ck", clientSecret: "cs" }, "https://x.app/dashboard/tiktok/callback", "abc"));
    expect(url.searchParams.get("scope")).toBe("user.info.basic,user.info.stats");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.app/dashboard/tiktok/callback");
    expect(url.searchParams.get("state")).toBe("abc");
  });
});

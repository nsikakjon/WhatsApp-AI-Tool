import { describe, expect, it } from "vitest";
import { createSignup } from "./index.js";
import type { Connection } from "./store.js";

const silent = { info() {}, error() {} };

function setup(fail?: "exchange" | "subscribe" | "register" | "details", limits?: { perVisitor: number; total: number }) {
  const saved: Connection[] = [];
  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url.includes("/oauth/access_token")) {
      return fail === "exchange" ? json(400, { error: { message: "bad code" } }) : json(200, { access_token: "BIZ_TOKEN" });
    }
    if (url.endsWith("/subscribed_apps")) {
      return fail === "subscribe" ? json(403, { error: { message: "no" } }) : json(200, { success: true });
    }
    if (url.endsWith("/register")) {
      return fail === "register" ? json(400, { error: { message: "bad pin" } }) : json(200, { success: true });
    }
    if (url.includes("fields=display_phone_number")) {
      return fail === "details" ? json(500, {}) : json(200, { display_phone_number: "+234 811 433 0749", verified_name: "KahnPrints" });
    }
    return json(404, {});
  }) as typeof fetch;
  const added: string[] = [];
  const app = createSignup({
    app: { appId: "APPID", appSecret: "APPSECRET", graphApiVersion: "v23.0" },
    configId: "CONFIG",
    store: { save: async (c) => void saved.push(c) },
    onConnected: async (c) => {
      added.push(c.phoneNumberId);
      return true;
    },
    perVisitorDailyLimit: limits?.perVisitor,
    dailyLimit: limits?.total,
    fetch: fakeFetch,
    log: silent,
  });
  const complete = (body: unknown, visitor = "1.2.3.4") =>
    app.request("/complete", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": visitor },
      body: JSON.stringify(body),
    });
  return { app, saved, calls, added, complete };
}

const finished = { code: "AQB-code_123", waba_id: "1463401605808243", phone_number_id: "1341325682404019", coexistence: true };

describe("sign-up page", () => {
  it("is open without a password and offers both ways to connect", async () => {
    const { app } = setup();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('const APP_ID = "APPID"');
    expect(html).toContain('const CONFIG_ID = "CONFIG"');
    expect(html).toContain("whatsapp_business_app_onboarding");
    expect(html).toContain("It's a new number");
    expect(html).toContain("https://yarnoga.com/data-deletion.html");
  });

  it("connects an app number without registering it, and adds it as a business", async () => {
    const { saved, calls, added, complete } = setup();
    const res = await complete(finished);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      number: "+234 811 433 0749",
      name: "KahnPrints",
      phoneNumberId: "1341325682404019",
      coexistence: true,
      pin: null,
      added: true,
    });
    expect(calls[0]).toContain("client_secret=APPSECRET");
    expect(calls[1]).toBe("POST https://graph.facebook.com/v23.0/1463401605808243/subscribed_apps");
    expect(calls.some((c) => c.endsWith("/register"))).toBe(false);
    expect(saved).toEqual([
      {
        phoneNumberId: "1341325682404019",
        wabaId: "1463401605808243",
        displayNumber: "+234 811 433 0749",
        verifiedName: "KahnPrints",
        coexistence: true,
        businessToken: "BIZ_TOKEN",
      },
    ]);
    expect(added).toEqual(["1341325682404019"]);
  });

  it("registers a new number with a six-digit PIN and shows the PIN once", async () => {
    const { calls, complete } = setup();
    const res = await complete({ ...finished, coexistence: false });
    expect(res.status).toBe(200);
    expect((await res.json()).pin).toMatch(/^\d{6}$/);
    expect(calls).toContain("POST https://graph.facebook.com/v23.0/1341325682404019/register");
  });

  it("never sends the business's token back to the browser", async () => {
    const { complete } = setup();
    expect(await (await complete(finished)).text()).not.toContain("BIZ_TOKEN");
  });

  it("limits finished sign-ups per visitor and per day", async () => {
    const { complete } = setup(undefined, { perVisitor: 1, total: 2 });
    expect((await complete(finished, "a")).status).toBe(200);
    expect((await complete(finished, "a")).status).toBe(429);
    expect((await complete(finished, "b")).status).toBe(200);
    expect((await complete(finished, "c")).status).toBe(429);
  });

  it("still saves the number if its details can't be read", async () => {
    const { saved, complete } = setup("details");
    const res = await complete(finished);
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
  });

  it("saves nothing when Meta refuses", async () => {
    for (const step of ["exchange", "subscribe", "register"] as const) {
      const { saved, added, complete } = setup(step);
      const res = await complete({ ...finished, coexistence: false });
      expect(res.status).toBe(502);
      expect(saved).toEqual([]);
      expect(added).toEqual([]);
    }
  });

  it("rejects missing or odd-looking details without calling Meta", async () => {
    const { calls, complete } = setup();
    expect((await complete({ ...finished, code: undefined })).status).toBe(400);
    expect((await complete({ ...finished, waba_id: "12/../me" })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

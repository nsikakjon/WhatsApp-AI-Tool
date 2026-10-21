import { describe, expect, it } from "vitest";
import { createSignup } from "./index.js";
import type { Connection } from "./store.js";

const silent = { info() {}, error() {} };
const AUTH = { Authorization: "Basic " + Buffer.from("jay:secret").toString("base64") };

function setup(fail?: "exchange" | "subscribe" | "details") {
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
    if (url.includes("fields=display_phone_number")) {
      return fail === "details" ? json(500, {}) : json(200, { display_phone_number: "+234 811 433 0749", verified_name: "KahnPrints" });
    }
    return json(404, {});
  }) as typeof fetch;
  const app = createSignup({
    password: "secret",
    app: { appId: "APPID", appSecret: "APPSECRET", graphApiVersion: "v23.0" },
    configId: "CONFIG",
    store: { save: async (c) => void saved.push(c) },
    fetch: fakeFetch,
    log: silent,
  });
  const complete = (body: unknown) =>
    app.request("/complete", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, saved, calls, complete };
}

const finished = { code: "AQB-code_123", waba_id: "1463401605808243", phone_number_id: "1341325682404019", coexistence: true };

describe("sign-up page", () => {
  it("asks for the password", async () => {
    const { app } = setup();
    expect((await app.request("/")).status).toBe(401);
    expect((await app.request("/complete", { method: "POST" })).status).toBe(401);
  });

  it("shows the Embedded Signup button with the app and configuration", async () => {
    const { app } = setup();
    const res = await app.request("/", { headers: AUTH });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('const APP_ID = "APPID"');
    expect(html).toContain('const CONFIG_ID = "CONFIG"');
    expect(html).toContain("whatsapp_business_app_onboarding");
  });

  it("swaps the code, connects the account to the bot and saves the number", async () => {
    const { saved, calls, complete } = setup();
    const res = await complete(finished);
    expect(res.status).toBe(200);
    expect((await res.json()).message).toContain("+234 811 433 0749 is connected");
    expect(calls[0]).toContain("client_secret=APPSECRET");
    expect(calls[1]).toBe("POST https://graph.facebook.com/v23.0/1463401605808243/subscribed_apps");
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
  });

  it("still saves the number if its details can't be read", async () => {
    const { saved, complete } = setup("details");
    const res = await complete(finished);
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
  });

  it("saves nothing when Meta refuses", async () => {
    for (const step of ["exchange", "subscribe"] as const) {
      const { saved, complete } = setup(step);
      const res = await complete(finished);
      expect(res.status).toBe(502);
      expect(saved).toEqual([]);
    }
  });

  it("rejects missing or odd-looking details without calling Meta", async () => {
    const { calls, complete } = setup();
    expect((await complete({ ...finished, code: undefined })).status).toBe(400);
    expect((await complete({ ...finished, waba_id: "12/../me" })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

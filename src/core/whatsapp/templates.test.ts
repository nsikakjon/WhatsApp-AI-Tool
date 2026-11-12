import { describe, expect, it } from "vitest";
import { createTemplateProvisioner, type ConnectedAccount } from "./templates.js";

const quiet = { info() {}, error() {} };
const account: ConnectedAccount = { phoneNumberId: "111", wabaId: "WABA1", token: "SHOP_TOKEN" };

/** A pretend Meta: the templates each account has (name -> status), and every call made. */
function meta(have: Record<string, string> = {}) {
  const calls: Array<{ method: string; url: string; auth: string; body?: any }> = [];
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, auth: String((init?.headers as Record<string, string>)?.Authorization), body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (url.includes("/message_templates") && method === "GET") {
      const name = new URL(url).searchParams.get("name")!;
      return json({ data: name in have ? [{ name, status: have[name], language: "en" }] : [] });
    }
    if (url.includes("/message_templates")) return json({ id: "t1", status: "PENDING" });
    if (url.includes("/APPID/uploads")) return json({ id: "upload:abc" });
    if (url.includes("/upload:abc")) return json({ h: "HANDLE" });
    return json({}, 404);
  }) as typeof fetch;
  return { doFetch, calls, creates: () => calls.filter((c) => c.method === "POST" && c.url.endsWith("/message_templates")) };
}

function provisioner(m: ReturnType<typeof meta>, accounts: ConnectedAccount[] = [account], now = () => 0) {
  return createTemplateProvisioner({
    app: { appId: "APPID", appSecret: "SECRET", graphApiVersion: "v23.0" },
    templates: { language: "en", text: "business_offer", image: "business_offer_image" },
    accounts: { get: async (id) => accounts.find((a) => a.phoneNumberId === id) ?? null, list: async () => accounts },
    sample: async () => ({ data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }),
    fetch: m.doFetch,
    now,
    log: quiet,
  });
}

describe("broadcast templates in a shop's own account", () => {
  it("makes both Marketing templates with the shop's own key, the picture one with a sample picture", async () => {
    const m = meta();
    await provisioner(m).ensure(account);
    const [text, image] = m.creates();
    expect(text!.url).toContain("/WABA1/message_templates");
    expect(text!.auth).toBe("Bearer SHOP_TOKEN");
    expect(text!.body).toMatchObject({ name: "business_offer", language: "en", category: "MARKETING" });
    expect(text!.body.components.map((c: { type: string }) => c.type)).toEqual(["BODY", "BUTTONS"]);
    expect(text!.body.components[0].text).toContain("{{1}}");
    expect(text!.body.components[1].buttons).toEqual([{ type: "QUICK_REPLY", text: "Stop promotions" }]);
    expect(image!.body.name).toBe("business_offer_image");
    expect(image!.body.components[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["HANDLE"] } });
    const upload = m.calls.find((c) => c.url.includes("/APPID/uploads"))!;
    expect(upload.auth).toBe("OAuth APPID|SECRET");
  });

  it("makes only what is missing, and leaves one Meta turned down alone", async () => {
    const m = meta({ business_offer: "APPROVED", business_offer_image: "REJECTED" });
    await provisioner(m).ensure(account);
    expect(m.creates()).toHaveLength(0);
    const half = meta({ business_offer: "PENDING" });
    await provisioner(half).ensure(account);
    expect(half.creates().map((c) => c.body.name)).toEqual(["business_offer_image"]);
  });

  it("carries on with the next template when one can't be made", async () => {
    const m = meta();
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/uploads") ? new Response(JSON.stringify({ error: { message: "no" } }), { status: 400 }) : m.doFetch(input, init)) as typeof fetch;
    await createTemplateProvisioner({
      app: { appId: "APPID", appSecret: "SECRET", graphApiVersion: "v23.0" },
      templates: { language: "en", text: "business_offer", image: "business_offer_image" },
      accounts: { get: async () => account, list: async () => [account] },
      sample: async () => ({ data: new Uint8Array([1]), mimeType: "image/jpeg" }),
      fetch: failing,
      log: quiet,
    }).ensure(account);
    expect(m.creates().map((c) => c.body.name)).toEqual(["business_offer"]);
  });

  it("says a shop is ready only when its templates are approved, and counts our own numbers as ready", async () => {
    let clock = 0;
    const waiting = provisioner(meta({ business_offer: "APPROVED", business_offer_image: "PENDING" }), [account], () => clock);
    expect(await waiting.ready("111")).toBe(false);
    expect(await waiting.ready("our-own-number")).toBe(true);
    const done = provisioner(meta({ business_offer: "APPROVED", business_offer_image: "APPROVED" }), [account], () => clock);
    expect(await done.ready("111")).toBe(true);
  });

  it("checks every connected account when it sweeps, and a failure on one doesn't stop the rest", async () => {
    const m = meta({ business_offer: "APPROVED", business_offer_image: "APPROVED" });
    const other = { phoneNumberId: "222", wabaId: "WABA2", token: "T2" };
    let first = true;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first) {
        first = false;
        return new Response("{}", { status: 500 });
      }
      return m.doFetch(input, init);
    }) as typeof fetch;
    await createTemplateProvisioner({
      app: { appId: "APPID", appSecret: "SECRET", graphApiVersion: "v23.0" },
      templates: { language: "en", text: "business_offer" },
      accounts: { get: async () => null, list: async () => [account, other] },
      sample: async () => ({ data: new Uint8Array(), mimeType: "image/jpeg" }),
      fetch: flaky,
      log: quiet,
    }).sweep();
    expect(m.calls.map((c) => c.url).some((u) => u.includes("/WABA2/"))).toBe(true);
  });
});

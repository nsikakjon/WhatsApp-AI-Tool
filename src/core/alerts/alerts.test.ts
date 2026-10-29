import { describe, expect, it, vi } from "vitest";
import { createAlerter, watchErrors } from "./alerter.js";
import { createSentry, parseDsn, stackFrames } from "./sentry.js";

describe("createAlerter", () => {
  it("sends by WhatsApp and email, then holds back the same kind for 30 minutes", async () => {
    let t = 0;
    const whatsapp = vi.fn(async () => {});
    const email = vi.fn(async () => {});
    const alerter = createAlerter({ whatsapp, email }, { now: () => t });
    await alerter.alert("errors", "an error happened", "boom");
    await alerter.alert("errors", "an error happened", "boom again");
    await alerter.alert("errors", "an error happened", "and again");
    expect(whatsapp).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledWith("yarnOga: an error happened", "boom");
    t = 31 * 60_000;
    await alerter.alert("errors", "an error happened", "later");
    expect(whatsapp).toHaveBeenCalledTimes(2);
    expect(whatsapp.mock.calls[1]![0]).toContain("2 more like this");
  });

  it("sends urgent alerts straight away and carries on when one channel fails", async () => {
    const email = vi.fn(async () => {});
    const alerter = createAlerter(
      { whatsapp: async () => Promise.reject(new Error("outside 24h")), email },
      { log: { warn: () => {} } },
    );
    await alerter.alert("health", "down", "x");
    await alerter.alert("health", "back up", "y", { urgent: true });
    expect(email).toHaveBeenCalledTimes(2);
  });
});

describe("watchErrors", () => {
  it("passes console.error on to Sentry and the alerter", async () => {
    const lines: unknown[][] = [];
    const target = { error: (...a: unknown[]) => void lines.push(a) };
    const capture = vi.fn();
    const alert = vi.fn(async () => {});
    const stop = watchErrors({ sentry: { capture }, alerter: { alert }, target });
    target.error("Failed to handle message:", new Error("db down"));
    expect(lines).toHaveLength(1);
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { context: "Failed to handle message:" });
    expect(alert.mock.calls[0]![2]).toContain("db down");
    stop();
    target.error("after");
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe("sentry", () => {
  it("reads a DSN and refuses anything else", () => {
    expect(parseDsn("https://abc@o1.ingest.sentry.io/42")).toMatchObject({
      key: "abc",
      envelopeUrl: "https://o1.ingest.sentry.io/api/42/envelope/",
    });
    expect(parseDsn("not a dsn")).toBeNull();
    expect(createSentry({ dsn: "nope" })).toBeNull();
  });

  it("sends an envelope once per error per minute", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    let t = 1_000_000;
    const sentry = createSentry({ dsn: "https://abc@o1.ingest.sentry.io/42", fetch, now: () => t })!;
    sentry.capture(new Error("boom"));
    sentry.capture(new Error("boom"));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    const event = JSON.parse(String(init.body).split("\n")[2]!);
    expect(event.exception.values[0].value).toBe("boom");
    t += 61_000;
    sentry.capture(new Error("boom"));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("turns a stack into frames, oldest first", () => {
    const frames = stackFrames("Error: x\n    at inner (/app/dist/a.js:1:2)\n    at /app/node_modules/b.js:3:4");
    expect(frames[0]).toMatchObject({ filename: "/app/node_modules/b.js", in_app: false });
    expect(frames[1]).toMatchObject({ function: "inner", lineno: 1, in_app: true });
  });
});

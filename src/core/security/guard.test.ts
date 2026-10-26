import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createLoginThrottle, guardedBasicAuth } from "./guard.js";

const quiet = { warn: () => {} };

function app(opts: { everyone?: number } = {}) {
  const a = new Hono();
  a.use("*", guardedBasicAuth({ password: "right-password", realm: "Test", failDelayMs: 0, log: quiet, ...opts }));
  a.get("/", (c) => c.text("in"));
  return a;
}

const as = (password: string, ip = "1.1.1.1") => ({
  headers: { Authorization: `Basic ${btoa(`x:${password}`)}`, "x-forwarded-for": ip },
});

describe("guardedBasicAuth", () => {
  it("asks for the password, refuses a wrong one and lets the right one in", async () => {
    const a = app();
    const none = await a.request("/");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Basic");
    expect((await a.request("/", as("nope"))).status).toBe(401);
    expect(await (await a.request("/", as("right-password"))).text()).toBe("in");
  });

  it("locks an address out after 5 wrong passwords, even for the right one", async () => {
    const a = app();
    for (let i = 0; i < 5; i++) expect((await a.request("/", as("guess" + i))).status).toBe(401);
    expect((await a.request("/", as("right-password"))).status).toBe(429);
    // Someone else is unaffected.
    expect((await a.request("/", as("right-password", "2.2.2.2"))).status).toBe(200);
  });

  it("locks everyone out when guesses come from many addresses", async () => {
    const a = app({ everyone: 3 });
    for (let i = 0; i < 3; i++) await a.request("/", as("nope", `9.9.9.${i}`));
    expect((await a.request("/", as("right-password", "3.3.3.3"))).status).toBe(429);
  });
});

describe("createLoginThrottle", () => {
  it("forgets failures after the window", () => {
    const t = createLoginThrottle(2, 1000);
    t.failed("a", 0);
    t.failed("a", 10);
    expect(t.blocked("a", 20)).toBe(true);
    expect(t.blocked("a", 2000)).toBe(false);
  });
});

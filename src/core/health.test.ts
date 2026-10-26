import { describe, expect, it, vi } from "vitest";
import { createHealthRoutes, createWatchdog, runChecks } from "./health.js";

describe("health", () => {
  it("keeps /health simple and reports every check on /health/full", async () => {
    const app = createHealthRoutes({
      checks: { database: async () => {}, whatsapp: async () => Promise.reject(new Error("token expired")) },
    });
    expect(await (await app.request("/health")).json()).toEqual({ ok: true });
    const full = await app.request("/health/full");
    expect(full.status).toBe(503);
    const body = await full.json();
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.whatsapp).toMatchObject({ ok: false, note: "token expired" });
    const page = await app.request("/status");
    expect(await page.text()).toContain("Not working");
  });

  it("fails a check that takes too long", async () => {
    const r = await runChecks({ checks: { slow: () => new Promise(() => {}) }, timeoutMs: 20 });
    expect(r.checks.slow).toMatchObject({ ok: false, note: "no answer in 0.02s" });
  });

  it("alerts after two failures in a row, and again when it recovers", async () => {
    let healthy = false;
    const alert = vi.fn(async () => {});
    const tick = createWatchdog({
      checks: { database: async () => (healthy ? undefined : Promise.reject(new Error("down"))) },
      labels: { database: "Database" },
      alerter: { alert },
    });
    await tick();
    expect(alert).not.toHaveBeenCalled();
    await tick();
    await tick();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![1]).toBe("Database is down");
    healthy = true;
    await tick();
    expect(alert.mock.calls[1]![1]).toBe("Database is back up");
  });
});

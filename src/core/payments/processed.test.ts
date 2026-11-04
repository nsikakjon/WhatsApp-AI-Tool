import { describe, expect, it } from "vitest";
import { createProcessedCounter, roundDownNaira } from "./processed.js";

describe("roundDownNaira", () => {
  it("keeps two leading digits and never rounds up", () => {
    expect(roundDownNaira(243_751_200)).toBe(2_400_000);
    expect(roundDownNaira(85_099_900)).toBe(850_000);
    expect(roundDownNaira(1_999_999_999_00)).toBe(1_900_000_000);
    expect(roundDownNaira(4_550)).toBe(45);
  });
});

describe("processed counter", () => {
  function counter(totals: number[], minKobo = 100_000_000) {
    let calls = 0;
    let clock = 0;
    const app = createProcessedCounter({
      totalKobo: async () => {
        const next = totals[Math.min(calls++, totals.length - 1)];
        if (next < 0) throw new Error("db down");
        return next;
      },
      minKobo,
      now: () => clock,
      log: { error: () => {} },
    });
    const get = async () => (await app.request("/", { headers: { Origin: "https://yarnoga.com" } })).json();
    return { get, tick: (ms: number) => (clock += ms), calls: () => calls };
  }

  it("says nothing until the total reaches the threshold", async () => {
    const { get } = counter([99_999_999]);
    expect(await get()).toEqual({});
  });

  it("shows the rounded-down naira once the threshold is reached", async () => {
    const { get } = counter([243_751_200]);
    expect(await get()).toEqual({ naira: 2_400_000 });
  });

  it("adds up again only after an hour, and keeps the last total if that fails", async () => {
    const c = counter([150_000_000, -1, 300_000_000]);
    await c.get();
    await c.get();
    expect(c.calls()).toBe(1);
    c.tick(61 * 60 * 1000);
    expect(await c.get()).toEqual({ naira: 1_500_000 });
    c.tick(61 * 60 * 1000);
    expect(await c.get()).toEqual({ naira: 3_000_000 });
  });

  it("lets only yarnoga.com read it from a browser", async () => {
    const app = createProcessedCounter({ totalKobo: async () => 0, minKobo: 1 });
    const ours = await app.request("/", { headers: { Origin: "https://yarnoga.com" } });
    const other = await app.request("/", { headers: { Origin: "https://example.com" } });
    expect(ours.headers.get("access-control-allow-origin")).toBe("https://yarnoga.com");
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

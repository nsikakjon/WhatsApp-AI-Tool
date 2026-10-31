import { describe, expect, it } from "vitest";
import type { Notice } from "../../core/product.js";
import { sendWinBacks, type Offer } from "./offers.js";

describe("sendWinBacks", () => {
  function setup(opts: { offer?: Offer | null; reachable?: boolean } = {}) {
    let claimed = false;
    const sent: Notice[] = [];
    const alerts: string[] = [];
    const run = (iso = "2026-10-31T10:00:00Z") =>
      sendWinBacks({
        store: { quiet: async () => [{ id: "b1", name: "Ada Cakes" }], claim: async () => (claimed ? false : (claimed = true)) },
        offer: async () => (opts.offer === undefined ? { code: "COMEBACK", percentOff: 30 } : opts.offer),
        entryPlan: async () => "Starter",
        owner: async () => ({ waId: "2348011111111" }),
        canMessageFreely: async () => opts.reachable ?? true,
        send: async (n) => {
          sent.push(n);
        },
        alertYarnoga: async (t) => {
          alerts.push(t);
        },
        now: () => new Date(iso),
      });
    return { run, sent, alerts };
  }

  it("sends the owner the code once, with a one-tap upgrade", async () => {
    const { run, sent } = setup();
    await run();
    await run();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.buttons?.body).toContain("code *COMEBACK* gives you 30% off your first month");
    expect(sent[0]?.buttons?.buttons[0]).toEqual({ id: "upgrade starter COMEBACK", title: "Starter, 30% off" });
  });

  it("tells yarnOga when the owner can't be messaged", async () => {
    const { run, sent, alerts } = setup({ reachable: false });
    await run();
    expect(sent).toHaveLength(0);
    expect(alerts[0]).toContain("win-back code is *COMEBACK*");
  });

  it("does nothing while the code is switched off, or outside 11am", async () => {
    const off = setup({ offer: null });
    await off.run();
    expect(off.sent).toHaveLength(0);
    const early = setup();
    await early.run("2026-10-31T07:00:00Z");
    expect(early.sent).toHaveLength(0);
  });
});

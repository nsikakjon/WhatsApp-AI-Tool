import { describe, expect, it } from "vitest";
import type { Notice } from "../../core/product.js";
import { checkUsageDrops, droppedBy40, type PayingBusiness, type Usage } from "./usage-drop.js";

describe("droppedBy40", () => {
  it("flags a fall of 40% or more, ignoring tiny numbers", () => {
    expect(droppedBy40({ orders: 30, chats: 100 }, { orders: 18, chats: 90 })).toEqual(["orders"]);
    expect(droppedBy40({ orders: 30, chats: 100 }, { orders: 19, chats: 60 })).toEqual(["chats"]);
    expect(droppedBy40({ orders: 9, chats: 19 }, { orders: 0, chats: 0 })).toEqual([]);
  });
});

describe("checkUsageDrops", () => {
  const shop: PayingBusiness = { id: "b1", name: "Ada Cakes", planName: "Starter", numberId: "PN1" };

  function setup(usage: { before: Usage; recent: Usage }, opts: { reachable?: boolean } = {}) {
    let claimed = false;
    const alerts: string[] = [];
    const sent: Notice[] = [];
    const run = (iso = "2026-10-31T09:00:00Z") =>
      checkUsageDrops({
        store: {
          paying: async () => [shop],
          usage: async (_b, from) => (from.getTime() < new Date(iso).getTime() - 31 * 86_400_000 ? usage.before : usage.recent),
          claim: async () => (claimed ? false : (claimed = true)),
        },
        alertYarnoga: async (t) => {
          alerts.push(t);
        },
        checkIn: {
          owner: async () => ({ waId: "2348011111111" }),
          canMessageFreely: async () => opts.reachable ?? true,
          send: async (n) => {
            sent.push(n);
          },
        },
        now: () => new Date(iso),
      });
    return { run, alerts, sent };
  }

  it("alerts yarnOga once and checks in with the owner", async () => {
    const { run, alerts, sent } = setup({ before: { orders: 30, chats: 100 }, recent: { orders: 12, chats: 70 } });
    await run();
    await run();
    expect(alerts).toEqual([
      [
        "Ada Cakes (Starter) has gone quiet:",
        "• 12 orders in the last 30 days, down from 30 (-60%)",
        "• 70 customer chats in the last 30 days, down from 100 (-30%)",
        "Owner: +2348011111111. Worth a call before they think about cancelling.",
      ].join("\n"),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.buttons?.buttons.map((b) => b.title)).toEqual(["All good", "Please call me"]);
  });

  it("does nothing when usage held up, or outside 10am", async () => {
    const steady = setup({ before: { orders: 30, chats: 100 }, recent: { orders: 25, chats: 90 } });
    await steady.run();
    expect(steady.alerts).toHaveLength(0);
    const night = setup({ before: { orders: 30, chats: 100 }, recent: { orders: 2, chats: 5 } });
    await night.run("2026-10-31T22:00:00Z");
    expect(night.alerts).toHaveLength(0);
  });

  it("still alerts yarnOga when the owner can't be messaged", async () => {
    const { run, alerts, sent } = setup({ before: { orders: 30, chats: 100 }, recent: { orders: 5, chats: 20 } }, { reachable: false });
    await run();
    expect(alerts).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });
});

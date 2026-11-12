import { describe, expect, it, vi } from "vitest";
import type { Payment } from "../../core/payments/store.js";
import { createMessagePackPaidHandler, createMessagePacks, type MessagePackStore } from "./broadcast-packs.js";

const quiet = { error() {} };
const store: MessagePackStore = {
  packs: async (billedBy) =>
    billedBy === "yarnoga"
      ? [{ code: "messages-100", name: "100 messages", messages: 100, priceKobo: 1500000 }]
      : [{ code: "own-messages-100", name: "100 messages", messages: 100, priceKobo: 250000 }],
};

describe("message packs", () => {
  it("sells by payment link, priced from the pack's row", async () => {
    const createLink = vi.fn(async () => ({ url: "https://pay.example/m", reference: "r" }));
    const packs = createMessagePacks({ businessId: "b", store, ownAccount: async () => false, links: { createLink } as never });
    expect(await packs.link("messages-100", "2348011111111")).toBe("https://pay.example/m");
    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 1500000, purpose: { kind: "broadcast_pack", businessId: "b", pack: "messages-100", messages: 100 } }),
    );
    expect(await packs.link("nope", "2348011111111")).toBeNull();
  });

  it("offers a shop on its own WhatsApp account the service-fee packs only", async () => {
    const createLink = vi.fn(async () => ({ url: "https://pay.example/m", reference: "r" }));
    const packs = createMessagePacks({ businessId: "b", store, ownAccount: async () => true, links: { createLink } as never });
    expect((await packs.packs()).map((p) => p.code)).toEqual(["own-messages-100"]);
    expect(await packs.link("messages-100", "2348011111111")).toBeNull();
  });

  it("has nothing on sale without payments, or before the packs table exists", async () => {
    expect(await createMessagePacks({ businessId: "b", store, ownAccount: async () => false }).packs()).toEqual([]);
    const broken = createMessagePacks({ businessId: "b", store: { packs: async () => Promise.reject(new Error("no table")) }, ownAccount: async () => false, links: {} as never, log: quiet });
    expect(await broken.packs()).toEqual([]);
  });
});

describe("a paid message pack", () => {
  const payment = (purpose: Record<string, unknown>): Payment => ({ reference: "ref-1", product: "quote", waId: "2348011111111", amountKobo: 1500000, purpose, status: "paid" }) as Payment;

  it("adds its messages once, however often the webhook is retried", async () => {
    const saved = new Set<string>();
    const add = vi.fn(async (t: { reference: string }) => !saved.has(t.reference) && Boolean(saved.add(t.reference)));
    const paid = createMessagePackPaidHandler({ add });
    const text = await paid(payment({ kind: "broadcast_pack", businessId: "b", pack: "messages-100", messages: 100 }));
    expect(text).toContain("₦15,000");
    expect(text).toContain("100 messages are added");
    expect(add).toHaveBeenCalledWith({ reference: "ref-1", businessId: "b", packCode: "messages-100", messages: 100, amountKobo: 1500000 });
    expect(await paid(payment({ kind: "broadcast_pack", businessId: "b", pack: "messages-100", messages: 100 }))).toBeNull();
  });

  it("refuses a payment it can't read", async () => {
    const paid = createMessagePackPaidHandler({ add: async () => true });
    await expect(paid(payment({ kind: "broadcast_pack", businessId: "b", pack: "messages-100", messages: 0 }))).rejects.toThrow("can't read");
  });
});

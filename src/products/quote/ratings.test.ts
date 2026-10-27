import { describe, expect, it, vi } from "vitest";
import { askForRatings, shouldAsk, type RatingCandidate, type RatingStore } from "./ratings.js";

const NOW = new Date("2026-10-26T11:00:00Z"); // noon in Lagos
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

describe("ratings", () => {
  it("asks a few hours after payment, or soon after delivery, never while it's on the road", () => {
    expect(shouldAsk({ paidAt: ago(60), delivery: null }, NOW)).toBe(false);
    expect(shouldAsk({ paidAt: ago(200), delivery: null }, NOW)).toBe(true);
    expect(shouldAsk({ paidAt: ago(200), delivery: { status: "picked_up", deliveredAt: null } }, NOW)).toBe(false);
    expect(shouldAsk({ paidAt: ago(200), delivery: { status: "delivered", deliveredAt: ago(10) } }, NOW)).toBe(false);
    expect(shouldAsk({ paidAt: ago(200), delivery: { status: "delivered", deliveredAt: ago(40) } }, NOW)).toBe(true);
    expect(shouldAsk({ paidAt: ago(60 * 50), delivery: null }, NOW)).toBe(false);
  });

  it("asks each order once, only inside the free window", async () => {
    const asked = new Set<string>();
    const candidates: RatingCandidate[] = [
      { id: "a", orderNumber: 1001, contactId: "c1", customerWaId: "2348000000001", paidAt: ago(300), delivery: null },
      { id: "b", orderNumber: 1002, contactId: "c2", customerWaId: "2348000000002", paidAt: ago(300), delivery: null },
    ];
    const store: RatingStore = {
      candidates: async () => candidates.filter((c) => !asked.has(c.id)),
      markAsked: async (id) => (asked.has(id) ? false : (asked.add(id), true)),
      save: async () => true,
    };
    const send = vi.fn(async () => {});
    const deps = { store, canMessageFreely: async (w: string) => w.endsWith("1"), isPaused: async () => false, send, now: () => NOW };
    expect(await askForRatings("b1", deps)).toBe(1);
    expect(send).toHaveBeenCalledWith("2348000000001", 1001);
    expect(await askForRatings("b1", deps)).toBe(0);
  });
});

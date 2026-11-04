import { describe, expect, it } from "vitest";
import { summariseAds, type AdLead } from "./ads.js";

const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
const lead = (over: Partial<AdLead>): AdLead => ({
  numberId: "PN1",
  contactId: "c1",
  sourceType: "ad",
  sourceId: "AD1",
  sourceUrl: null,
  headline: null,
  firstAt: daysAgo(1),
  freeUntil: null,
  ...over,
});

describe("summariseAds", () => {
  it("counts different people per ad and number, not messages", () => {
    const ads = summariseAds(
      [
        lead({ contactId: "c1", firstAt: daysAgo(40), headline: "Old headline" }),
        lead({ contactId: "c1", firstAt: daysAgo(2), headline: "New headline" }),
        lead({ contactId: "c2", firstAt: daysAgo(10), freeUntil: new Date(now.getTime() + 3_600_000) }),
        lead({ contactId: "c3", sourceId: "AD2", firstAt: daysAgo(1) }),
        lead({ contactId: "c1", numberId: "PN2" }),
      ],
      now,
    );
    const ad1 = ads.find((a) => a.sourceId === "AD1" && a.numberId === "PN1")!;
    expect(ad1).toMatchObject({ leads: 2, leads7: 1, leads30: 2, freeNow: 1, headline: "New headline" });
    expect(ad1.firstBy.get("c1")).toEqual(daysAgo(40));
    expect(ads).toHaveLength(3);
    expect(ads[0]!.sourceId).toBe("AD1");
  });

  it("doesn't count a window that has run out", () => {
    const [ad] = summariseAds([lead({ freeUntil: daysAgo(1) })], now);
    expect(ad!.freeNow).toBe(0);
  });
});

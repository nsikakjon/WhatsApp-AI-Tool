import { describe, expect, it } from "vitest";
import { customerCode, discountCommand, parseEndDate, readCode, type ApplyResult, type DiscountCode, type DiscountStore } from "./discounts.js";
import type { SavedOrder } from "./store.js";

const NOW = new Date("2026-10-21T22:00:00Z");

function memory(order: SavedOrder | null = null) {
  const codes: DiscountCode[] = [];
  const applied: Array<[string, string]> = [];
  const store: DiscountStore = {
    async apply(orderId, code): Promise<ApplyResult> {
      const c = codes.find((x) => x.code === code && x.active);
      if (!c) return { result: "unknown", code };
      if (c.endsAt && c.endsAt <= NOW) return { result: "ended", code };
      if (c.maxUses != null && c.orders >= c.maxUses) return { result: "full", code };
      applied.push([orderId, code]);
      const items = order!.lines.reduce((s, l) => s + l.totalKobo, 0);
      const off = Math.floor((items * c.percentOff) / 100);
      return { result: "applied", code, percentOff: c.percentOff, discountKobo: off, totalKobo: items - off };
    },
    isCode: async (code) => codes.some((c) => c.code === code && c.active),
    codes: async () => codes.map((c) => ({ ...c })),
    async save(c) {
      const existing = codes.find((x) => x.code === c.code);
      if (existing) Object.assign(existing, c, { active: true });
      else codes.push({ ...c, active: true, orders: 0, discountKobo: 0 });
    },
    async setActive(code, active) {
      const c = codes.find((x) => x.code === code);
      if (c) c.active = active;
      return !!c;
    },
  };
  return { store, codes, applied };
}

const quote: SavedOrder = {
  id: "o1",
  orderNumber: 1043,
  totalKobo: 1_000_000,
  lines: [{ variantId: "v1", name: "Flyers: A5", quantity: 100, unitPriceKobo: 10_000, totalKobo: 1_000_000 }],
};
const ref = (o: SavedOrder) => `KP-${o.orderNumber}`;

describe("owner discount codes", () => {
  it("makes a code with an end date and a limit", async () => {
    const { store, codes } = memory();
    const reply = await discountCommand(store, "new code blackfriday 30% until 29 Nov limit 100", NOW);
    expect(reply).toBe(
      "Done. *BLACKFRIDAY* gives 30% off, until 29 Nov, for the first 100 orders. Customers send *BLACKFRIDAY* after they get a quote. Send *codes* to see how many orders each code brings in.",
    );
    expect(codes[0]).toMatchObject({ code: "BLACKFRIDAY", percentOff: 30, maxUses: 100, endsAt: new Date("2026-11-29T23:00:00Z") });
  });

  it("lists codes with the orders they brought in, and pauses them", async () => {
    const { store, codes } = memory();
    await discountCommand(store, "new code XMAS 20%", NOW);
    await discountCommand(store, "new code TOLU10 10% limit 50", NOW);
    Object.assign(codes[1]!, { orders: 12, discountKobo: 3_400_000 });
    expect(await discountCommand(store, "code xmas off", NOW)).toContain("paused");
    const list = await discountCommand(store, "codes", NOW);
    expect(list).toContain("• *XMAS*: 20% off, 0 orders, paused");
    expect(list).toContain("• *TOLU10*: 10% off, 12 orders (₦34,000 off), 38 left");
    expect(await discountCommand(store, "code NOPE1 on", NOW)).toContain("don't have a code called NOPE1");
  });

  it("explains what it couldn't read", async () => {
    const { store } = memory();
    expect(await discountCommand(store, "new code XMAS", NOW)).toContain("How much off?");
    expect(await discountCommand(store, "new code XMAS 95%", NOW)).toContain("1% to 90%");
    expect(await discountCommand(store, "new code XMAS 20% until someday", NOW)).toContain("couldn't read that date");
    expect(await discountCommand(store, "new code X! 20%", NOW)).toContain("letters and numbers");
    expect(await discountCommand(store, "paid KP-1001", NOW)).toBeNull();
  });

  it("reads end dates as the end of that day in Lagos, next year once passed", () => {
    expect(parseEndDate("25 Dec", NOW)).toEqual(new Date("2026-12-25T23:00:00Z"));
    expect(parseEndDate("25th December", NOW)).toEqual(new Date("2026-12-25T23:00:00Z"));
    expect(parseEndDate("1/1", NOW)).toEqual(new Date("2027-01-01T23:00:00Z"));
    expect(parseEndDate("10 Oct", NOW)).toEqual(new Date("2027-10-10T23:00:00Z"));
    expect(parseEndDate("31 Feb", NOW)).toBeNull();
  });
});

describe("customers sending a code", () => {
  it("only treats one word, or 'code' and a word, as a code", () => {
    expect(readCode("xmas")).toEqual({ code: "XMAS", explicit: false });
    expect(readCode("Promo code: TOLU10")).toEqual({ code: "TOLU10", explicit: true });
    expect(readCode("100 flyers please")).toBeNull();
  });

  it("takes the discount off the open quote and shows the new total", async () => {
    const { store } = memory(quote);
    await discountCommand(store, "new code XMAS 20%", NOW);
    const reply = await customerCode(store, "xmas", async () => quote, ref);
    expect(reply).toContain("Code *XMAS* applied: 20% off. Your quote (KP-1043) is now:");
    expect(reply).toContain("• Discount (XMAS) = -₦2,000");
    expect(reply).toContain("*Total: ₦8,000*");
  });

  it("leaves ordinary words to the bot, and says why a real code didn't work", async () => {
    const { store, codes } = memory(quote);
    expect(await customerCode(store, "thanks", async () => quote, ref)).toBeNull();
    expect(await customerCode(store, "code THANKS", async () => quote, ref)).toContain("isn't a code I recognise");
    await discountCommand(store, "new code XMAS 20% limit 5", NOW);
    codes[0]!.orders = 5;
    expect(await customerCode(store, "XMAS", async () => quote, ref)).toContain("used up");
    expect(await customerCode(store, "XMAS", async () => null, ref)).toContain("Ask me for a quote first");
    expect(await customerCode(store, "hello", async () => null, ref)).toBeNull();
  });
});

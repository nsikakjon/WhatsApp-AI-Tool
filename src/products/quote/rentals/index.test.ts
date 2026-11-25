import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import type { Variant } from "../pricing.js";
import { createHireBookings, damageIn, HOLD_HOURS, type OwnerTools } from "./index.js";
import { memoryRentals } from "./testing.js";

// Wednesday 25 Nov 2026, 10am in Lagos.
let clock = new Date("2026-11-25T09:00:00Z");
const now = () => clock;

const GEN: Variant = { id: "gen", name: "Generator: 20kVA", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 25_000_00 }] };
const CHAIRS: Variant = { id: "chairs", name: "Plastic chairs", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 200_00 }] };
const MUGS: Variant = { id: "mugs", name: "Branded mugs", minQuantity: 6, tiers: [{ minQuantity: 6, unitPriceKobo: 3_500_00 }] };
const VARIANTS = [GEN, CHAIRS, MUGS];
const ORDERS = {
  o1: { number: 1012, contactId: "c1", waId: "2348011111111", name: "Ada" },
  o2: { number: 1013, contactId: "c2", waId: "2348022222222", name: "Musa" },
};

function setup() {
  clock = new Date("2026-11-25T09:00:00Z");
  const store = memoryRentals({ now, names: { gen: GEN.name, chairs: CHAIRS.name }, orders: ORDERS });
  const hire = createHireBookings({
    businessName: "Demo Hire",
    orderPrefix: "DEMO",
    store,
    catalog: { activeVariants: async () => VARIANTS },
    orders: {
      findOrder: async (n: number) => {
        const [id, o] = Object.entries(ORDERS).find(([, o]) => o.number === n) ?? [];
        return id && o ? { id, orderNumber: n, totalKobo: 0, lines: [], status: "paid", customerWaId: o.waId, customerName: o.name, createdAt: clock, paidAt: null } : null;
      },
    },
    now,
  });
  return { store, hire };
}

const owner = (text: string): IncomingMessage => ({ from: "2348000000000", waMessageId: "w", type: "text", text, timestamp: 0 }) as IncomingMessage;
const tools: OwnerTools = { chargeBalance: async () => ({ label: "DEMO-1050", url: "https://pay.example/1050" }) };

describe("hire quotes", () => {
  it("leaves items that aren't for hire alone", async () => {
    const { hire } = setup();
    expect(await hire.quote({ items: [{ variantId: "mugs", quantity: 6 }], variants: VARIANTS, text: "6 mugs" })).toBeNull();
  });

  it("asks for the dates when they're missing", async () => {
    const { store, hire } = setup();
    await store.setItem("gen", { units: 2 });
    const q = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }], variants: VARIANTS, text: "do you have a 20kva generator?" });
    expect(q && "reply" in q && q.reply).toMatch(/Which dates do you need the Generator: 20kVA/);
  });

  it("quotes the days, the weekly rate and the deposit from the database", async () => {
    const { store, hire } = setup();
    await store.setItem("gen", { units: 2, depositKobo: 50_000_00, weeklyKobo: 120_000_00 });
    const q = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }, { variantId: "mugs", quantity: 6 }], variants: VARIANTS, text: "generator for 3 days from Friday" });
    if (!q || !("lines" in q)) throw new Error("expected a quote");
    expect(q.lines).toEqual([
      { variantId: "gen", name: "Generator: 20kVA hire, Fri 27 Nov to Mon 30 Nov (3 days)", quantity: 1, unitPriceKobo: 75_000_00, totalKobo: 75_000_00 },
      { variantId: "gen", name: "Refundable deposit: Generator: 20kVA", quantity: 1, unitPriceKobo: 50_000_00, totalKobo: 50_000_00 },
    ]);
    expect(q.rest).toEqual([{ variantId: "mugs", quantity: 6 }]);
    expect(q.note).toMatch(/Out Fri 27 Nov, back Mon 30 Nov/);
  });

  it("reads the dates from earlier in the chat", async () => {
    const { store, hire } = setup();
    await store.setItem("chairs", { units: 300 });
    const q = await hire.quote({
      items: [{ variantId: "chairs", quantity: 100 }],
      variants: VARIANTS,
      text: "100 chairs",
      history: [{ direction: "inbound", text: "I have an event on Saturday" }, { direction: "outbound", text: "What do you need?" }, { direction: "inbound", text: "for 2 days" }],
    });
    expect(q && "bookings" in q && q.bookings[0]).toMatchObject({ start: "2026-11-28", back: "2026-11-30", units: 100 });
  });

  it("never books more than are free and says when they're free next", async () => {
    const { store, hire } = setup();
    await store.setItem("gen", { units: 1 });
    const first = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }], variants: VARIANTS, text: "27 Nov to 30 Nov" });
    if (!first || !("bookings" in first)) throw new Error("expected a quote");
    await hire.saveQuote("o1", first.bookings);
    // A quote holds nothing; a YES holds the dates.
    expect(await hire.hold("o1", "DEMO-1012")).toBeNull();
    const second = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }], variants: VARIANTS, text: "28 Nov for 2 days" });
    expect(second && "reply" in second && second.reply).toBe("Sorry, the Generator: 20kVA is booked on those dates. 1 is free from Mon 30 Nov for the same 2 days.");
  });

  it("refuses the second YES for the last unit", async () => {
    const { store, hire } = setup();
    await store.setItem("gen", { units: 1 });
    const q = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }], variants: VARIANTS, text: "friday for 3 days" });
    if (!q || !("bookings" in q)) throw new Error("expected a quote");
    await hire.saveQuote("o1", q.bookings);
    await hire.saveQuote("o2", q.bookings);
    expect(await hire.hold("o1", "DEMO-1012")).toBeNull();
    expect(await hire.hold("o2", "DEMO-1013")).toMatch(/^Sorry, the Generator: 20kVA for Fri 27 Nov to Mon 30 Nov \(3 days\) was just booked/);
    // Once the hold runs out unpaid, the dates are free again.
    clock = new Date(clock.getTime() + (HOLD_HOURS + 1) * 3_600_000);
    expect(await hire.hold("o2", "DEMO-1013")).toBeNull();
  });

  it("books the dates once paid", async () => {
    const { store, hire } = setup();
    await store.setItem("gen", { units: 1 });
    const q = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }], variants: VARIANTS, text: "friday for 3 days" });
    if (!q || !("bookings" in q)) throw new Error("expected a quote");
    await hire.saveQuote("o1", q.bookings);
    await hire.hold("o1", "DEMO-1012");
    const paid = await hire.paid("o1");
    expect(paid?.customer).toMatch(/Your hire is booked:\n• 1 x Generator: 20kVA: Fri 27 Nov to Mon 30 Nov/);
    expect(paid?.owner).toMatch(/Send \*out DEMO-1012\*/);
    expect(paid?.owner).not.toMatch(/double booked/);
    expect(await hire.paid("o1")).toBeNull();
  });
});

describe("owner commands", () => {
  it("sets up a hire item", async () => {
    const { store, hire } = setup();
    expect((await hire.ownerCommand(owner("hire"), tools))?.text).toMatch(/1\. Branded mugs\n2\. Generator: 20kVA\n3\. Plastic chairs/);
    expect((await hire.ownerCommand(owner("hire 2 units 3 deposit 50,000 week 120000"), tools))?.text).toMatch(/✅ Generator: 20kVA is for hire\.\n• 3 owned\n• ₦25,000 a day/);
    expect(store.hireItems.get("gen")).toEqual({ variantId: "gen", units: 3, weeklyKobo: 120_000_00, depositKobo: 50_000_00 });
    expect((await hire.ownerCommand(owner("hire 2 deposit 15k"), tools))?.text).toMatch(/couldn't read the deposit/);
    await hire.ownerCommand(owner("hire 2 off"), tools);
    expect(store.hireItems.has("gen")).toBe(false);
  });

  it("leaves other owner messages alone", async () => {
    const { hire } = setup();
    expect(await hire.ownerCommand(owner("back in stock"), tools)).toBeNull();
    expect(await hire.ownerCommand(owner("out of stock 3"), tools)).toBeNull();
    expect(await hire.ownerCommand(owner("paid DEMO-1012"), tools)).toBeNull();
  });

  it("sends it out and checks it back in from a voice note, taking late days and damage off the deposit", async () => {
    const { store, hire } = setup();
    await store.setItem("gen", { units: 1, depositKobo: 50_000_00 });
    const q = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }], variants: VARIANTS, text: "friday for 3 days" });
    if (!q || !("bookings" in q)) throw new Error("expected a quote");
    await hire.saveQuote("o1", q.bookings);
    await hire.hold("o1", "DEMO-1012");
    await hire.paid("o1");
    expect((await hire.ownerCommand(owner("out DEMO-1012"), tools))?.text).toMatch(/^DEMO-1012 is out: 1 x Generator: 20kVA, due back Mon 30 Nov\./);
    // Back on Tuesday, a day late.
    clock = new Date("2026-12-01T10:00:00Z");
    const reply = await hire.ownerCommand(owner("Back, DEMO-1012. Damage 10,000 naira, broken handle."), tools);
    expect(reply?.text).toBe(
      "✅ DEMO-1012 checked back in: 1 x Generator: 20kVA.\nDeposit paid: ₦50,000\nLate return, 1 day: -₦25,000\nDamage or missing parts (broken handle): -₦10,000\n👉 Refund ₦15,000 to Ada (+2348011111111).\n\nI've sent the customer the same breakdown.",
    );
    expect(reply?.notify?.[0]).toMatchObject({ to: "2348011111111" });
    expect(reply?.notify?.[0]?.text).toMatch(/We'll send ₦15,000 of your deposit back to you\./);
    expect((await hire.ownerCommand(owner("back DEMO-1012"), tools))?.text).toBe("DEMO-1012 was already checked back in.");
  });

  it("sends a pay link when the deposit doesn't cover it", async () => {
    const { store, hire } = setup();
    await store.setItem("gen", { units: 1, depositKobo: 10_000_00 });
    const q = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }], variants: VARIANTS, text: "today for 1 day" });
    if (!q || !("bookings" in q)) throw new Error("expected a quote");
    await hire.saveQuote("o1", q.bookings);
    await hire.hold("o1", "DEMO-1012");
    await hire.paid("o1");
    const reply = await hire.ownerCommand(owner("back 1012 damage ₦30,000 cracked panel"), tools);
    expect(reply?.text).toMatch(/₦20,000 is still owed: DEMO-1050, pay link sent\./);
    expect(reply?.notify?.[0]?.text).toMatch(/₦20,000 is still to pay \(DEMO-1050\)\.\nPay here: https:\/\/pay\.example\/1050/);
  });

  it("reads damage amounts", () => {
    expect(damageIn("damage 15,000 broken handle")).toBe(15_000_00);
    expect(damageIn("missing cable, charge 15 thousand")).toBe(15_000_00);
    expect(damageIn("all good")).toBeNull();
  });
});

describe("reminders and the owner's summary", () => {
  async function booked(store: ReturnType<typeof setup>["store"], hire: ReturnType<typeof setup>["hire"], text: string) {
    await store.setItem("gen", { units: 2, depositKobo: 50_000_00 });
    const q = await hire.quote({ items: [{ variantId: "gen", quantity: 1 }], variants: VARIANTS, text });
    if (!q || !("bookings" in q)) throw new Error("expected a quote");
    await hire.saveQuote("o1", q.bookings);
    await hire.hold("o1", "DEMO-1012");
    await hire.paid("o1");
  }

  it("reminds the customer the day before, the day before it's due back and once when it's late", async () => {
    const { store, hire } = setup();
    await booked(store, hire, "tomorrow for 2 days");
    const start = await hire.dueReminders(clock);
    expect(start).toHaveLength(1);
    expect(start[0]?.text).toBe("Reminder from Demo Hire: your hire of 1 x Generator: 20kVA (DEMO-1012) starts tomorrow, Thu 26 Nov. Reply here if anything has changed.");
    expect(await hire.dueReminders(clock)).toEqual([]);
    await hire.ownerCommand(owner("out DEMO-1012"), tools);
    clock = new Date("2026-11-26T09:00:00Z");
    expect(await hire.dueReminders(clock)).toEqual([]);
    clock = new Date("2026-11-27T09:00:00Z");
    expect((await hire.dueReminders(clock))[0]?.text).toMatch(/is due back tomorrow, Sat 28 Nov/);
    clock = new Date("2026-11-29T09:00:00Z");
    expect((await hire.dueReminders(clock))[0]?.text).toMatch(/was due back on Sat 28 Nov\. Late days are charged at ₦25,000 a day/);
    expect(await hire.dueReminders(clock)).toEqual([]);
    // Not at night.
    clock = new Date("2026-11-29T22:00:00Z");
    expect(await hire.dueReminders(clock)).toEqual([]);
  });

  it("sums up the day for the owner", async () => {
    const { store, hire } = setup();
    await booked(store, hire, "monday for 2 days");
    store.paid.push({ at: new Date("2026-11-24T15:00:00Z"), kobo: 100_000_00 });
    const text = await hire.summary(clock);
    expect(text).toMatch(/^\*Demo Hire hire, Wed 25 Nov\*/);
    expect(text).toMatch(/Money in yesterday: ₦100,000 from 1 hire order\./);
    expect(text).toMatch(/Deposits you're holding: ₦50,000\./);
    clock = new Date("2026-11-30T07:00:00Z");
    expect(await hire.summary(clock)).toMatch(/\*Going out today \(1\)\*\n• DEMO-1012 1 x Generator: 20kVA, Ada \+2348011111111, back Wed 2 Dec/);
    expect(await hire.claimSummary(clock)).toBe(true);
    expect(await hire.claimSummary(clock)).toBe(false);
  });
});

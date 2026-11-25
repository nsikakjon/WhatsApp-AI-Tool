import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import type { QuoteLine, Variant } from "../pricing.js";
import { createAppointments, type CustomerContext } from "./index.js";
import { createMemoryAppointmentStore } from "./testing.js";

const OWNER = "2348000000001";
const CUSTOMER = "2348012345678";

const variants: Variant[] = [
  { id: "v-physio", name: "Physiotherapy: Standard", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 1_500_000 }] },
  { id: "v-spin", name: "Spin class: Standard", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 300_000 }] },
  { id: "v-water", name: "Bottled water: Standard", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 30_000 }] },
];

function text(body: string, from = CUSTOMER): IncomingMessage {
  return { waMessageId: `wamid.${body}`, from, contactName: "Ada", type: "text", text: body, timestamp: 1, raw: {} };
}

function setup(start = "2026-11-25T09:00:00Z", onPlan = true) {
  let now = new Date(start);
  const mem = createMemoryAppointmentStore(() => now);
  const charged: QuoteLine[] = [];
  const booking = createAppointments({
    businessName: "FitLab",
    store: mem.store,
    catalog: { activeVariants: async () => variants },
    ownerWaId: OWNER,
    features: { has: async () => onPlan, limit: async () => null } as never,
    now: () => now,
  });
  const ctx = (waId = CUSTOMER, url: string | null = "https://pay.test/1"): CustomerContext => ({
    contactId: `c-${waId}`,
    waId,
    name: "Ada",
    checkout: async (_customer, line) => {
      charged.push(line);
      return { orderId: `o-${charged.length}`, label: `FL-${charged.length}`, url };
    },
  });
  const owner = async (body: string) => (await booking.ownerCommand(text(body, OWNER)))?.text ?? "";
  return { booking, mem, charged, ctx, owner, setNow: (d: string) => (now = new Date(d)) };
}

/** Owner set-up for a clinic with two doctors and a gym class. */
async function clinic(s: ReturnType<typeof setup>) {
  await s.owner("book 2 60min");
  await s.owner("calendar 1 Mon-Fri 9-5");
  await s.owner("calendar add Dr Bayo");
  await s.owner("calendar 2 Mon-Fri 9-12");
  await s.owner("book 3 45min class 2");
  await s.owner("book 3 pay later");
  await s.owner("class 3 Mon Wed Fri 7am");
}

describe("owner set-up", () => {
  it("makes a service bookable, with a starter calendar", async () => {
    const s = setup();
    expect(await s.owner("book 2 60min")).toContain("I made a calendar for you, *FitLab*, open Mon-Sat");
    expect(await s.owner("book 2 deposit 5,000")).toContain("₦5,000 deposit to book");
    const list = await s.owner("booking");
    expect(list).toContain("2. Physiotherapy 📅 60 min, ₦5,000 deposit");
    expect(list).toContain("3. Spin class\n");
    expect(list).toContain("1. FitLab: Mon-Sat 9:00am-5:00pm");
  });

  it("sets classes, hours and blocks, and refuses off-plan", async () => {
    const s = setup();
    await clinic(s);
    const list = await s.owner("booking");
    expect(list).toContain("3. Spin class 📅 45 min, class of 2, Mon, Wed, Fri 7:00am, pays at the visit");
    expect(list).toContain("2. Dr Bayo: Mon-Fri 9:00am-12:00pm");
    expect(await s.owner("block Fri 2-4 for 1")).toContain("Blocked Fri 27 Nov 2:00pm-4:00pm for FitLab");
    expect(await s.owner("calendar 9 Mon 9-5")).toContain("There's no calendar 9");
    expect(await setup(undefined, false).owner("booking")).toContain("comes with Pro and above");
  });
});

describe("customers booking", () => {
  it("walks through service, person, day and time, then holds it for payment", async () => {
    const s = setup();
    await clinic(s);
    const first = await s.booking.customerMessage(text("I want to book"), s.ctx());
    expect(first?.list?.rows.map((r) => r.title)).toEqual(["Physiotherapy", "Spin class"]);

    const people = await s.booking.customerMessage(text(first!.list!.rows[0]!.id), s.ctx());
    expect(people?.list?.rows.map((r) => r.title)).toEqual(["First free", "FitLab", "Dr Bayo"]);

    const days = await s.booking.customerMessage(text(people!.list!.rows[2]!.id), s.ctx());
    // Dr Bayo works mornings, Mon-Fri; Wednesday's morning is nearly over with 2 hours' notice.
    expect(days?.list?.rows[0]).toMatchObject({ title: "Thu 26 Nov", description: "3 free times" });

    const times = await s.booking.customerMessage(text(days!.list!.rows[0]!.id), s.ctx());
    expect(times?.list?.rows.map((r) => r.title)).toEqual(["9:00am", "10:00am", "11:00am"]);

    const held = await s.booking.customerMessage(text(times!.list!.rows[1]!.id), s.ctx());
    expect(held?.text).toContain("I'm holding *Physiotherapy*, Thu 26 Nov, 10:00am with Dr Bayo for you for 30 minutes (B1000)");
    expect(held?.text).toContain("Pay ₦15,000 here to book it: https://pay.test/1");
    expect(s.charged[0]).toMatchObject({ variantId: "v-physio", totalKobo: 1_500_000, name: "Physiotherapy, Thu 26 Nov, 10:00am" });

    // Someone else tapping the same time while it's held gets the free times instead.
    const again = await s.booking.customerMessage(text(times!.list!.rows[1]!.id), s.ctx("2348099999999"));
    expect(again?.text).toBe("Sorry, that time has just gone. Here's what's still free:");
    expect(again?.list?.rows.map((r) => r.title)).toEqual(["9:00am", "11:00am"]);

    const paid = await s.booking.paid("o-1");
    expect(paid?.customer).toContain("You're booked ✅ Physiotherapy, *Thu 26 Nov, 10:00am* with Dr Bayo (B1000)");
    expect(paid?.owner).toBe("Booked B1000: Physiotherapy, Thu 26 Nov, 10:00am with Dr Bayo.");
  });

  it("takes a deposit and books a class place free", async () => {
    const s = setup();
    await clinic(s);
    await s.owner("book 2 deposit 5000");
    const day = (await s.booking.customerMessage(text("BK p v-physio any"), s.ctx()))!.list!.rows[0]!;
    const time = (await s.booking.customerMessage(text(day.id), s.ctx()))!.list!.rows[0]!;
    const held = await s.booking.customerMessage(text(time.id), s.ctx());
    expect(held?.text).toContain("Pay ₦5,000 deposit here to book it");
    expect(held?.text).toContain("The other ₦10,000 is paid at your visit.");
    expect(s.charged[0]?.name).toMatch(/^Deposit: Physiotherapy/);

    // The spin class has 2 places: the third person can't have Friday 7am.
    const classDays = await s.booking.customerMessage(text("BK s v-spin"), s.ctx());
    expect(classDays?.list?.rows[0]).toMatchObject({ title: "Fri 27 Nov", description: "7:00am · 2 places left" });
    const fri = (await s.booking.customerMessage(text(classDays!.list!.rows[0]!.id), s.ctx()))!.list!.rows[0]!;
    const one = await s.booking.customerMessage(text(fri.id), s.ctx("2348011111111"));
    expect(one?.text).toContain("You're booked ✅ *Spin class*, Fri 27 Nov, 7:00am");
    expect(one?.text).toContain("You pay ₦3,000 at your visit.");
    expect(one?.notify?.[0]?.to).toBe(OWNER);
    await s.booking.customerMessage(text(fri.id), s.ctx("2348022222222"));
    const third = await s.booking.customerMessage(text(fri.id), s.ctx("2348033333333"));
    expect(third?.text).toBe("Sorry, that time has just gone. Here's what's still free:");
    expect(third?.list?.rows[0]?.title).not.toBe("7:00am");
    expect(await s.owner("bookings Fri")).toContain("• 7:00am Spin class: 2 booked (Ada, Ada)");
  });

  it("books straight away when there's no pay link, and sends the AI's pick to the booking lists", async () => {
    const s = setup();
    await clinic(s);
    expect(await s.booking.forQuote(["v-water"], variants)).toBeNull();
    const fromAi = await s.booking.forQuote(["v-physio"], variants);
    expect(fromAi?.list?.button).toBe("Pick a person");
    const day = (await s.booking.customerMessage(text("BK p v-physio any"), s.ctx()))!.list!.rows[0]!;
    const time = (await s.booking.customerMessage(text(day.id), s.ctx()))!.list!.rows[0]!;
    const done = await s.booking.customerMessage(text(time.id), s.ctx(CUSTOMER, null));
    expect(done?.text).toContain("You're booked ✅");
    expect(done?.text).toContain("Please pay ₦15,000 to FitLab to keep it (order FL-1).");
  });

  it("lets customers cancel or change before the cut-off, and leaves other messages alone", async () => {
    const s = setup();
    await clinic(s);
    expect(await s.booking.customerMessage(text("Do you sell books?"), s.ctx())).toBeNull();
    const fri = (await s.booking.customerMessage(text("BK d v-spin any 2026-11-27 0"), s.ctx()))!.list!.rows[0]!;
    await s.booking.customerMessage(text(fri.id), s.ctx());
    const mine = await s.booking.customerMessage(text("my bookings"), s.ctx());
    expect(mine?.buttons?.body).toBe("B1000: *Spin class*, Fri 27 Nov, 7:00am");

    const change = await s.booking.customerMessage(text("BK c 1000"), s.ctx());
    expect(change?.list?.body).toContain("Pick a new day for B1000");
    const mon = change!.list!.rows.find((r) => r.title === "Mon 30 Nov")!;
    const monTime = (await s.booking.customerMessage(text(mon.id), s.ctx()))!.list!.rows[0]!;
    const moved = await s.booking.customerMessage(text(monTime.id), s.ctx());
    expect(moved?.text).toBe("Done: B1000 is now *Spin class*, Mon 30 Nov, 7:00am. See you then!");
    expect(s.charged).toHaveLength(0);

    // Someone else can't cancel it.
    expect((await s.booking.customerMessage(text("BK x 1000"), s.ctx("2348099999999")))?.text).toContain("isn't open any more");
    s.setNow("2026-11-29T22:00:00Z");
    expect((await s.booking.customerMessage(text("BK x 1000"), s.ctx()))?.text).toContain("less than 12 hours away");
    s.setNow("2026-11-28T09:00:00Z");
    const cancelled = await s.booking.customerMessage(text("BK x 1000"), s.ctx());
    expect(cancelled?.text).toContain("B1000 is cancelled.");
    expect(cancelled?.notify?.[0]?.text).toContain("B1000 cancelled by Ada");
  });
});

describe("reminders, holds and the owner's day", () => {
  it("reminds the day before and 2 hours before, once each, and lets unpaid holds go", async () => {
    const s = setup();
    await clinic(s);
    const time = (await s.booking.customerMessage(text("BK d v-physio any 2026-11-26 0"), s.ctx()))!.list!.rows[0]!;
    await s.booking.customerMessage(text(time.id), s.ctx());
    await s.booking.paid("o-1");
    const other = (await s.booking.customerMessage(text("BK d v-physio any 2026-11-26 0"), s.ctx("2348077777777")))!.list!.rows[0]!;
    await s.booking.customerMessage(text(other.id), s.ctx("2348077777777"));

    // 9am Thursday booking: the day reminder goes from 9pm Wednesday, but only in the daytime.
    s.setNow("2026-11-25T18:00:00Z");
    const day = await s.booking.due(new Date("2026-11-25T18:00:00Z"));
    expect(day.map((n) => n.to)).toContain(CUSTOMER);
    expect(day.find((n) => n.to === CUSTOMER)?.text).toBe("Reminder: you're booked for Physiotherapy at FitLab, *Thu 26 Nov, 9:00am* with FitLab (B1000).");
    expect(day.find((n) => n.to === CUSTOMER)?.buttons?.buttons.map((b) => b.title)).toEqual(["Change time", "Cancel"]);
    // The unpaid hold was let go.
    expect(day.find((n) => n.to === "2348077777777")?.text).toContain("as the payment didn't come through");
    expect(s.mem.cancelledOrders.has("o-2")).toBe(true);
    expect(await s.booking.due(new Date("2026-11-25T18:15:00Z"))).toEqual([]);

    const soon = await s.booking.due(new Date("2026-11-26T07:00:00Z"));
    expect(soon).toHaveLength(1);
    expect(soon[0]?.text).toContain("is at *9:00am* today");
    expect(soon[0]?.buttons).toBeUndefined();
  });

  it("lists the day, marks visits and moves bookings for the owner", async () => {
    const s = setup();
    await clinic(s);
    const time = (await s.booking.customerMessage(text("BK d v-physio any 2026-11-26 0"), s.ctx()))!.list!.rows[0]!;
    await s.booking.customerMessage(text(time.id), s.ctx(CUSTOMER, null));
    expect(await s.owner("bookings tomorrow")).toBe("*Bookings, Thu 26 Nov* (1)\n• 9:00am Physiotherapy: Ada with FitLab (B1000)");
    const summary = await s.booking.summary(new Date("2026-11-26T06:00:00Z"));
    expect(summary).toContain("Good morning");
    expect(await s.booking.claimSummary(new Date("2026-11-26T06:00:00Z"))).toBe(true);
    expect(await s.booking.claimSummary(new Date("2026-11-26T06:15:00Z"))).toBe(false);

    const moved = await s.booking.ownerCommand(text("move B1000 to Fri 2pm", OWNER));
    expect(moved?.text).toBe("B1000 moved to Fri 27 Nov, 2:00pm. I've told Ada.");
    expect(moved?.notify?.[0]).toMatchObject({ to: CUSTOMER });
    expect(await s.owner("block Fri 2-4")).toContain("Already booked then: B1000");
    expect(await s.owner("done B1000")).toBe("B1000 marked done ✓.");
    expect(await s.owner("bookings Fri")).toContain("(B1000) ✓");
  });
});

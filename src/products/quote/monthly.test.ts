import { describe, expect, it, vi } from "vitest";
import type { SavedCard } from "../../core/payments/paystack.js";
import type { Payment } from "../../core/payments/store.js";
import type { Notice } from "../../core/product.js";
import { addDays, createMonthly, lagosToday, nextPayDay, type Member } from "./monthly.js";
import { memoryMonthlyStore as memoryStore } from "./monthly-testing.js";

const quiet = { info() {}, warn() {}, error() {} };
const CARD: SavedCard = { code: "AUTH_1", email: "ada@example.com", label: "Visa ••4081" };

function setup(opts: { member?: Partial<Member>; reachable?: boolean; card?: "success" | "failed" | "pending"; template?: boolean } = {}) {
  const { store, months, member } = memoryStore(opts.member);
  let now = new Date("2026-11-05T09:00:00Z");
  const sent: Notice[] = [];
  const monthly = createMonthly({
    store,
    payments: {
      createLink: vi.fn(async () => ({ url: "https://checkout.paystack.com/x", amountKobo: 1_500_000, promo: null })),
      chargeCard: vi.fn(async () => {
        const result = opts.card ?? "success";
        if (result === "success") {
          const id = months[0]!.id;
          await monthly.paid({ reference: "ref-card", purpose: { monthId: id } } as unknown as Payment, CARD);
          return "paid" as const;
        }
        return result;
      }),
    },
    businessId: "b1",
    businessName: "Iron Gym",
    subaccount: "ACCT_abc",
    feeKobo: async (amount) => Math.floor((amount * 250) / 10_000),
    canMessageFreely: async () => opts.reachable ?? true,
    template: opts.template ? { name: "monthly_due", language: "en" } : undefined,
    send: async (n) => {
      sent.push(n);
    },
    ownerWaId: "2348099999999",
    now: () => now,
    log: quiet,
  });
  return { monthly, months, member, sent, setNow: (d: string) => (now = new Date(d)) };
}

describe("monthly payment dates", () => {
  it("keeps the same pay day each month, or the last day of a shorter month", () => {
    expect(nextPayDay("2026-11-05", 5)).toBe("2026-12-05");
    expect(nextPayDay("2026-12-05", 5)).toBe("2027-01-05");
    expect(nextPayDay("2027-01-31", 31)).toBe("2027-02-28");
    expect(nextPayDay("2027-02-28", 31)).toBe("2027-03-31");
    expect(addDays("2026-11-29", 3)).toBe("2026-12-02");
    expect(lagosToday(new Date("2026-11-04T23:30:00Z"))).toBe("2026-11-05");
  });
});

describe("monthly payments", () => {
  it("sends a pay link on the pay day, and counts the payment once", async () => {
    const { monthly, months, member, sent } = setup();
    await monthly.run();
    await monthly.run();
    expect(months).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: member.waId });
    expect(sent[0]!.text).toContain("₦15,000 for Gym membership, November at Iron Gym is due");
    expect(sent[0]!.text).toContain("https://checkout.paystack.com/x");

    const payment = { reference: "ref1", purpose: { monthId: months[0]!.id, feeKobo: 37_500 } } as unknown as Payment;
    const notes = await monthly.paid(payment);
    expect(notes[0]!.text).toContain("next payment is due on 5 December");
    expect(notes[1]!.text).toContain("less yarnOga's fee of ₦375");
    expect(await monthly.paid(payment)).toEqual([]);
    expect(member.nextDue).toBe("2026-12-05");
  });

  it("charges a saved card without a link and sends nothing else", async () => {
    const { monthly, sent, member } = setup({ member: { card: CARD } });
    await monthly.run();
    expect(sent).toEqual([]);
    expect(member.nextDue).toBe("2026-12-05");
  });

  it("sends a link when the saved card is declined, and says so", async () => {
    const { monthly, sent } = setup({ member: { card: CARD }, card: "failed" });
    await monthly.run();
    expect(sent[0]!.text).toContain("We tried your Visa ••4081 but the payment didn't go through");
  });

  it("waits a day before sending a link while a card charge is processing", async () => {
    const { monthly, sent, setNow } = setup({ member: { card: CARD }, card: "pending" });
    await monthly.run();
    setNow("2026-11-05T15:00:00Z");
    await monthly.run();
    expect(sent).toEqual([]);
    setNow("2026-11-06T10:00:00Z");
    await monthly.run();
    expect(sent).toHaveLength(1);
  });

  it("reminds after 3 and 7 days, then tells the owner, once each", async () => {
    const { monthly, sent, setNow } = setup();
    await monthly.run();
    setNow("2026-11-08T09:00:00Z");
    await monthly.run();
    await monthly.run();
    setNow("2026-11-12T09:00:00Z");
    await monthly.run();
    await monthly.run();
    expect(sent.map((n) => n.to)).toEqual(["2348011111111", "2348011111111", "2348011111111", "2348099999999"]);
    expect(sent[3]!.text).toContain("hasn't paid ₦15,000 for Gym membership, November");
  });

  it("gives the owner the link when WhatsApp won't let the bot message the customer", async () => {
    const { monthly, sent } = setup({ reachable: false });
    await monthly.run();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "2348099999999" });
    expect(sent[0]!.text).toContain("send them this link from your phone");
  });

  it("uses the approved template when there is one", async () => {
    const { monthly, sent } = setup({ reachable: false, template: true });
    await monthly.run();
    expect(sent[0]!.template).toMatchObject({ name: "monthly_due", bodyParams: ["Ada", "Iron Gym", "₦15,000", "Gym membership, November", "https://checkout.paystack.com/x"] });
  });

  it("does nothing at night or before the pay day, or for cancelled members", async () => {
    const night = setup();
    night.setNow("2026-11-05T21:00:00Z");
    await night.monthly.run();
    expect(night.sent).toEqual([]);
    const early = setup({ member: { nextDue: "2026-11-20" } });
    await early.monthly.run();
    expect(early.months).toEqual([]);
    const gone = setup({ member: { status: "cancelled" } });
    await gone.monthly.run();
    expect(gone.sent).toEqual([]);
  });
});

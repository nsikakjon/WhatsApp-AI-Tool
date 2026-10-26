import { describe, expect, it, vi } from "vitest";
import type { Payment } from "../../core/payments/store.js";
import { orderPayLinks, transactionFeeKobo, withOrderPayments } from "./paylinks.js";

const payment = (purpose: Record<string, unknown>): Payment => ({
  id: "p1",
  reference: "yarnoga-quote-1",
  product: "quote",
  waId: "2348012345678",
  purpose,
  amountKobo: 1_500_000,
  status: "paid",
});

describe("order pay links", () => {
  it("asks for a link to the business's subaccount for the order total", async () => {
    const createLink = vi.fn(async () => ({ url: "https://checkout.paystack.com/abc", amountKobo: 1_500_000, promo: null }));
    const link = orderPayLinks({ links: { createLink }, businessId: "b2", businessName: "Demo Shop", orderPrefix: "DEMO", subaccount: "ACCT_abc" });
    expect(await link({ id: "o1", orderNumber: 1010, totalKobo: 1_500_000, lines: [] }, "2348012345678")).toBe("https://checkout.paystack.com/abc");
    expect(createLink).toHaveBeenCalledWith({
      product: "quote",
      waId: "2348012345678",
      amountKobo: 1_500_000,
      currency: "NGN",
      purpose: { kind: "order", businessId: "b2", orderNumber: 1010 },
      title: "Demo Shop order DEMO-1010",
      subaccount: "ACCT_abc",
    });
  });

  it("sends order payments to the business and everything else to plan upgrades", async () => {
    const planPaid = vi.fn(async () => [{ to: "x", text: "plan" }]);
    const orderPaid = vi.fn(async () => [{ to: "y", text: "order" }]);
    const handler = withOrderPayments(planPaid, orderPaid);
    expect(await handler(payment({ kind: "order", businessId: "b2", orderNumber: 1010 }))).toEqual([{ to: "y", text: "order" }]);
    expect(orderPaid).toHaveBeenCalledWith("b2", 1010, 0, 0);
    await handler(payment({ kind: "order", businessId: "b2", orderNumber: 1011, feeKobo: 37_500 }));
    expect(orderPaid).toHaveBeenLastCalledWith("b2", 1011, 37_500, 0);
    expect(await handler(payment({ businessId: "b2", plan: "pro", months: 1 }))).toEqual([{ to: "x", text: "plan" }]);
    await expect(handler(payment({ kind: "order", businessId: "b2" }))).rejects.toThrow("can't find");
  });

  it("takes the plan's fee off the business's share, never adding it to the customer's total", async () => {
    const createLink = vi.fn(async () => ({ url: "https://checkout.paystack.com/abc", amountKobo: 1_500_000, promo: null }));
    const link = orderPayLinks({
      links: { createLink },
      businessId: "b2",
      businessName: "Demo Shop",
      orderPrefix: "DEMO",
      subaccount: "ACCT_abc",
      feeBasisPoints: async () => 250,
    });
    await link({ id: "o1", orderNumber: 1010, totalKobo: 1_500_000, lines: [] }, "2348012345678");
    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        amountKobo: 1_500_000,
        platformFeeKobo: 37_500,
        purpose: { kind: "order", businessId: "b2", orderNumber: 1010, feeKobo: 37_500 },
      }),
    );
  });

  it("works the fee out in whole kobo", () => {
    expect(transactionFeeKobo(1_500_000, 250)).toBe(37_500);
    expect(transactionFeeKobo(10_001, 250)).toBe(250);
    expect(transactionFeeKobo(10_020, 250)).toBe(251);
    expect(transactionFeeKobo(1_500_000, 0)).toBe(0);
  });

  it("caps yarnOga's 2.5% at N2,000, or 800 FCFA in whole francs", () => {
    expect(transactionFeeKobo(1_500_000, 250, 200_000)).toBe(37_500); // N15,000 -> N375
    expect(transactionFeeKobo(20_000_000, 250, 200_000)).toBe(200_000); // N200,000 -> capped at N2,000
    expect(transactionFeeKobo(1_000_000, 250, 80_000, "XOF")).toBe(25_000); // 10 000 F -> 250 F
    expect(transactionFeeKobo(5_000_000, 250, 80_000, "XOF")).toBe(80_000); // 50 000 F -> capped at 800 F
    expect(transactionFeeKobo(1_234_500, 250, 80_000, "XOF")).toBe(30_800); // 308.6 F -> 308 F
  });

  it("asks for a CFA franc link to the business's Flutterwave subaccount, with the capped fee", async () => {
    const createLink = vi.fn(async () => ({ url: "https://checkout.flutterwave.com/v3/hosted/pay/x", amountKobo: 5_000_000, promo: null }));
    const link = orderPayLinks({
      links: { createLink },
      businessId: "b3",
      businessName: "Chez Awa",
      orderPrefix: "CA",
      subaccount: "RS_ABC123",
      currency: "XOF",
      feeBasisPoints: async () => 250,
    });
    await link({ id: "o1", orderNumber: 1001, totalKobo: 5_000_000, lines: [] }, "2250712345678");
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ currency: "XOF", subaccount: "RS_ABC123", platformFeeKobo: 80_000 }));
  });

  it("sends a courier fee to yarnOga in the split, with our fee on the business's part only", async () => {
    const createLink = vi.fn(async () => ({ url: "https://checkout.paystack.com/abc", amountKobo: 1_850_000, promo: null }));
    const link = orderPayLinks({
      links: { createLink },
      businessId: "b2",
      businessName: "Demo Shop",
      orderPrefix: "DEMO",
      subaccount: "ACCT_abc",
      feeBasisPoints: async () => 250,
      courierKobo: async () => 350_000,
    });
    await link({ id: "o1", orderNumber: 1010, totalKobo: 1_850_000, lines: [] }, "2348012345678");
    // 2.5% of the N15,000 items is N375; plus the N3,500 courier fee.
    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 1_850_000, platformFeeKobo: 387_500, purpose: expect.objectContaining({ feeKobo: 37_500, courierKobo: 350_000 }) }),
    );
  });

  it("routes an owner's courier-fee payment to the courier booking", async () => {
    const courierPaid = vi.fn(async () => [{ to: "z", text: "booked" }]);
    const orderPaid = vi.fn(async () => []);
    const handler = withOrderPayments(vi.fn(), orderPaid, courierPaid);
    expect(await handler(payment({ kind: "courier", businessId: "b2", orderNumber: 1010 }))).toEqual([{ to: "z", text: "booked" }]);
    await handler(payment({ kind: "order", businessId: "b2", orderNumber: 1011, courierKobo: 350_000 }));
    expect(orderPaid).toHaveBeenLastCalledWith("b2", 1011, 0, 350_000);
  });
});

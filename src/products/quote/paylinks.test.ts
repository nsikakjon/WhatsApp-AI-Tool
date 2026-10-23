import { describe, expect, it, vi } from "vitest";
import type { Payment } from "../../core/payments/store.js";
import { orderPayLinks, withOrderPayments } from "./paylinks.js";

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
    expect(orderPaid).toHaveBeenCalledWith("b2", 1010);
    expect(await handler(payment({ businessId: "b2", plan: "pro", months: 1 }))).toEqual([{ to: "x", text: "plan" }]);
    await expect(handler(payment({ kind: "order", businessId: "b2" }))).rejects.toThrow("can't find");
  });
});

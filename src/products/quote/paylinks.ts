import type { OutgoingNote, PaidHandler, PaymentLinks } from "../../core/payments/payments.js";
import type { SavedOrder } from "./store.js";

// Pay links on quote invoices (QUOTE_PAY_LINKS). The customer pays on
// Paystack and the money goes straight to the business's own bank account
// through its Paystack subaccount, so yarnOga never holds it. The order is
// marked paid once Paystack confirms (QuoteProduct.orderPaid).
//
// yarnOga's fee (the plan's transaction_fee, migration 0048) is kept back by
// Paystack when it splits the payment. The customer pays the order total and
// nothing more; the business gets the total less our fee and Paystack's.

export const PAYSTACK_SUBACCOUNT = /^ACCT_[a-z0-9]+$/i;

/** Our fee on a payment, in kobo: `basisPoints` hundredths of a percent (250 = 2.5%), rounded to the nearest kobo. */
export function transactionFeeKobo(totalKobo: number, basisPoints: number): number {
  if (!Number.isInteger(totalKobo) || !Number.isInteger(basisPoints) || basisPoints <= 0) return 0;
  return Math.floor((totalKobo * basisPoints + 5_000) / 10_000);
}

export function orderPayLinks(opts: {
  links: PaymentLinks;
  businessId: string;
  businessName: string;
  orderPrefix: string;
  subaccount: string;
  /** The plan's fee in hundredths of a percent; 0 or left out = no fee. */
  feeBasisPoints?: () => Promise<number>;
}): (order: SavedOrder, waId: string) => Promise<string> {
  return async (order, waId) => {
    const feeKobo = opts.feeBasisPoints ? transactionFeeKobo(order.totalKobo, await opts.feeBasisPoints()) : 0;
    const link = await opts.links.createLink({
      product: "quote",
      waId,
      amountKobo: order.totalKobo,
      purpose: { kind: "order", businessId: opts.businessId, orderNumber: order.orderNumber, ...(feeKobo ? { feeKobo } : {}) },
      title: `${opts.businessName} order ${opts.orderPrefix}-${order.orderNumber}`,
      subaccount: opts.subaccount,
      ...(feeKobo ? { platformFeeKobo: feeKobo } : {}),
    });
    if (!link.url) throw new Error("Paystack gave no link");
    return link.url;
  };
}

/** Quote payments are plan upgrades, or orders paid by pay link. */
export function withOrderPayments(
  planPaid: PaidHandler,
  orderPaid: (businessId: string, orderNumber: number, feeKobo: number) => Promise<OutgoingNote[]>,
): PaidHandler {
  return async (payment) => {
    if (payment.purpose.kind !== "order") return planPaid(payment);
    const { businessId, orderNumber, feeKobo } = payment.purpose as { businessId?: unknown; orderNumber?: unknown; feeKobo?: unknown };
    if (typeof businessId !== "string" || !Number.isInteger(orderNumber)) {
      throw new Error(`Payment ${payment.reference} is for an order we can't find: ${JSON.stringify(payment.purpose)}`);
    }
    return orderPaid(businessId, orderNumber as number, Number.isInteger(feeKobo) ? (feeKobo as number) : 0);
  };
}

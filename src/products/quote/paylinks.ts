import type { OutgoingNote, PaidHandler, PaymentLinks } from "../../core/payments/payments.js";
import type { SavedOrder } from "./store.js";

// Pay links on quote invoices (QUOTE_PAY_LINKS). The customer pays on
// Paystack and the money goes straight to the business's own bank account
// through its Paystack subaccount, so yarnOga never holds it. The order is
// marked paid once Paystack confirms (QuoteProduct.orderPaid).

export const PAYSTACK_SUBACCOUNT = /^ACCT_[a-z0-9]+$/i;

export function orderPayLinks(opts: {
  links: PaymentLinks;
  businessId: string;
  businessName: string;
  orderPrefix: string;
  subaccount: string;
}): (order: SavedOrder, waId: string) => Promise<string> {
  return async (order, waId) => {
    const link = await opts.links.createLink({
      product: "quote",
      waId,
      amountKobo: order.totalKobo,
      purpose: { kind: "order", businessId: opts.businessId, orderNumber: order.orderNumber },
      title: `${opts.businessName} order ${opts.orderPrefix}-${order.orderNumber}`,
      subaccount: opts.subaccount,
    });
    if (!link.url) throw new Error("Paystack gave no link");
    return link.url;
  };
}

/** Quote payments are plan upgrades, or orders paid by pay link. */
export function withOrderPayments(
  planPaid: PaidHandler,
  orderPaid: (businessId: string, orderNumber: number) => Promise<OutgoingNote[]>,
): PaidHandler {
  return async (payment) => {
    if (payment.purpose.kind !== "order") return planPaid(payment);
    const { businessId, orderNumber } = payment.purpose as { businessId?: unknown; orderNumber?: unknown };
    if (typeof businessId !== "string" || !Number.isInteger(orderNumber)) {
      throw new Error(`Payment ${payment.reference} is for an order we can't find: ${JSON.stringify(payment.purpose)}`);
    }
    return orderPaid(businessId, orderNumber as number);
  };
}

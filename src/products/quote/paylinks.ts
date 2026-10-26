import type { OutgoingNote, PaidHandler, PaymentLinks } from "../../core/payments/payments.js";
import type { Currency } from "../../core/money.js";
import type { SavedOrder } from "./store.js";

// Pay links on quote invoices (QUOTE_PAY_LINKS). Naira orders are paid on
// Paystack, CFA franc orders on Flutterwave (Mobile Money or card), and the
// money goes straight to the business's own account through its subaccount,
// so yarnOga never holds it. The order is marked paid once the provider
// confirms (QuoteProduct.orderPaid).
//
// yarnOga's fee (the plan's transaction_fee, 2.5%, migration 0048) is capped
// (₦2,000, or 800 FCFA, migration 0052) and kept back when the provider splits
// the payment. The customer pays the order total and nothing more; the
// business gets the total less our fee and the provider's.

export const PAYSTACK_SUBACCOUNT = /^ACCT_[a-z0-9]+$/i;
export const FLUTTERWAVE_SUBACCOUNT = /^RS_[A-Za-z0-9]+$/;

/** The cap on our fee when the plan doesn't set one: ₦2,000, or 800 FCFA, in hundredths. */
export const DEFAULT_FEE_CAP: Record<Currency, number> = { NGN: 200_000, XOF: 80_000, XAF: 80_000 };

/**
 * Our fee on a payment, in hundredths: `basisPoints` hundredths of a percent
 * (250 = 2.5%), rounded to the nearest kobo, at most `capKobo`. In CFA francs
 * it's rounded down to whole francs, as Flutterwave can't split centimes.
 */
export function transactionFeeKobo(totalKobo: number, basisPoints: number, capKobo: number | null = null, currency: Currency = "NGN"): number {
  if (!Number.isInteger(totalKobo) || !Number.isInteger(basisPoints) || basisPoints <= 0) return 0;
  let fee = Math.floor((totalKobo * basisPoints + 5_000) / 10_000);
  if (capKobo !== null && Number.isInteger(capKobo) && capKobo >= 0) fee = Math.min(fee, capKobo);
  if (currency !== "NGN") fee -= fee % 100;
  return fee;
}

export function orderPayLinks(opts: {
  links: PaymentLinks;
  businessId: string;
  businessName: string;
  orderPrefix: string;
  /** Paystack's ACCT_... for naira, Flutterwave's RS_... for CFA francs. */
  subaccount: string;
  /** The business's currency; NGN when left out. */
  currency?: Currency;
  /** The plan's fee in hundredths of a percent; 0 or left out = no fee. */
  feeBasisPoints?: () => Promise<number>;
  /** The most the fee can be, in hundredths of the currency; null = the default cap. */
  feeCap?: () => Promise<number | null>;
}): (order: SavedOrder, waId: string) => Promise<string> {
  const currency = opts.currency ?? "NGN";
  return async (order, waId) => {
    const cap = (opts.feeCap ? await opts.feeCap() : null) ?? DEFAULT_FEE_CAP[currency];
    const feeKobo = opts.feeBasisPoints ? transactionFeeKobo(order.totalKobo, await opts.feeBasisPoints(), cap, currency) : 0;
    const link = await opts.links.createLink({
      product: "quote",
      waId,
      amountKobo: order.totalKobo,
      currency,
      purpose: { kind: "order", businessId: opts.businessId, orderNumber: order.orderNumber, ...(feeKobo ? { feeKobo } : {}) },
      title: `${opts.businessName} order ${opts.orderPrefix}-${order.orderNumber}`,
      subaccount: opts.subaccount,
      ...(feeKobo ? { platformFeeKobo: feeKobo } : {}),
    });
    if (!link.url) throw new Error("No payment link was made");
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

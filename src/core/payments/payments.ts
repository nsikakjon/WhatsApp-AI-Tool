import { randomUUID } from "node:crypto";
import { assertKobo } from "../money.js";
import type { FlutterwaveClient } from "./flutterwave.js";
import type { Payment, PaymentStore } from "./store.js";

// Payment links for any product, and what happens once one is paid.
//
// A product asks for a link (it has already looked the price up in the
// database), we save a pending payment and send back a Flutterwave link. When
// Flutterwave tells us a transaction finished, we ask Flutterwave ourselves
// whether it really was paid and for the full amount, mark our payment paid
// (once only), and hand it to the product that asked for it.

export interface PaymentRequest {
  /** The product asking, e.g. "flyer". Its onPaid handler is called once paid. */
  product: string;
  /** WhatsApp number of the person paying. */
  waId: string;
  /** Looked up from the database by the product; never from the AI. */
  amountKobo: number;
  /** What the payment is for, given back to the product once paid. */
  purpose: Record<string, unknown>;
  /** Shown on the checkout page. */
  title: string;
  payerName?: string;
}

/** What products see: they can ask for a link, nothing else. */
export interface PaymentLinks {
  createLink(req: PaymentRequest): Promise<string>;
}

/** A product's reaction to a paid payment: messages to send (to the payer, owners, ...). */
export type PaidHandler = (payment: Payment) => Promise<Array<{ to: string; text: string }>>;

export type ConfirmResult = "paid" | "already-paid" | "not-paid" | "unknown";

export interface Payments extends PaymentLinks {
  /** Checks a Flutterwave transaction and, if it's newly paid, activates what was bought. */
  confirm(transactionId: string): Promise<ConfirmResult>;
}

export interface PaymentsOptions {
  flutterwave: FlutterwaveClient;
  store: PaymentStore;
  /** Our "thank you" page Flutterwave sends people to after paying. */
  redirectUrl: string;
  /** Flutterwave requires an email on every payment; WhatsApp doesn't give us one. */
  customerEmail: string;
  /** Per product: what to do once paid. */
  onPaid: Record<string, PaidHandler>;
  /** Sends a WhatsApp message on behalf of a product. Failures are logged, not retried. */
  send: (product: string, to: string, text: string) => Promise<void>;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export function createPayments(opts: PaymentsOptions): Payments {
  const log = opts.log ?? console;

  return {
    async createLink(req) {
      assertKobo(req.amountKobo);
      if (req.amountKobo === 0) throw new Error("Can't take a payment of ₦0");
      const txRef = `duro-${req.product}-${randomUUID()}`;
      await opts.store.create({
        txRef,
        product: req.product,
        waId: req.waId,
        purpose: req.purpose,
        amountKobo: req.amountKobo,
        currency: "NGN",
      });
      return opts.flutterwave.createLink({
        txRef,
        amountKobo: req.amountKobo,
        redirectUrl: opts.redirectUrl,
        customer: { email: opts.customerEmail, phone: req.waId, name: req.payerName },
        title: req.title,
      });
    },

    async confirm(transactionId) {
      // Never trust what the webhook says: ask Flutterwave directly.
      const tx = await opts.flutterwave.verify(transactionId);
      if (tx.status !== "successful") return "not-paid";

      const payment = await opts.store.byRef(tx.txRef);
      if (!payment) {
        log.warn(`Flutterwave transaction ${tx.id} has a reference we didn't make (${tx.txRef}); ignoring`);
        return "unknown";
      }
      if (payment.status === "paid") return "already-paid";
      if (tx.currency !== payment.currency || tx.amountKobo < payment.amountKobo) {
        log.error(
          `Flutterwave transaction ${tx.id} for ${payment.txRef} paid ${tx.currency} ${tx.amountKobo} kobo, expected ${payment.currency} ${payment.amountKobo}; not activating`,
        );
        return "not-paid";
      }

      if (!(await opts.store.markPaid(payment.id, tx.id))) return "already-paid";

      const handler = opts.onPaid[payment.product];
      let messages: Array<{ to: string; text: string }> = [];
      try {
        if (!handler) throw new Error(`no product called "${payment.product}" takes payments`);
        messages = await handler(payment);
      } catch (err) {
        // Put it back to pending so Flutterwave's retry (or the thank-you page) can try again.
        await opts.store.markPending(payment.id);
        throw err;
      }
      log.info(`Payment ${payment.txRef} (${payment.amountKobo} kobo) paid via Flutterwave ${tx.id}`);

      for (const m of messages) {
        try {
          await opts.send(payment.product, m.to, m.text);
        } catch (err) {
          log.error(`Paid, but couldn't message ...${m.to.slice(-4)}:`, err);
        }
      }
      return "paid";
    },
  };
}

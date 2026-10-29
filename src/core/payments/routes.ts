import { Hono } from "hono";
import { isValidFlutterwaveHash } from "./flutterwave.js";
import { isValidPaystackSignature } from "./paystack.js";
import type { ConfirmResult, Payments } from "./payments.js";

export interface PaymentRoutesDeps {
  payments: Payments;
  /** Paystack's secret key, which signs its webhooks. Unset: the Paystack webhook is off. */
  secretKey?: string;
  /** Flutterwave's secret hash (FLUTTERWAVE_SECRET_HASH). Unset: the Flutterwave webhook is off. */
  flutterwaveHash?: string;
  log?: Pick<Console, "info" | "warn" | "error">;
}

const REFERENCE = /^yarnoga-[a-z]+-[0-9a-f-]{36}$/;

/**
 * POST /webhooks/paystack: Paystack tells us a payment went through.
 * POST /webhooks/flutterwave: the same from Flutterwave (CFA francs).
 * GET /payments/done: where the payer's browser lands after paying. It checks
 * the payment too, so the purchase switches on even if the webhook is late.
 */
export function createPaymentRoutes(deps: PaymentRoutesDeps) {
  const log = deps.log ?? console;
  const app = new Hono();

  app.post("/webhooks/paystack", async (c) => {
    const rawBody = await c.req.text();
    if (!deps.secretKey || !isValidPaystackSignature(rawBody, c.req.header("x-paystack-signature"), deps.secretKey)) {
      log.warn("Rejected Paystack webhook with an invalid signature");
      return c.text("Invalid signature", 401);
    }

    let body: { event?: string; data?: { reference?: string } };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.text("Invalid JSON", 400);
    }
    const reference = body.data?.reference;
    if (body.event !== "charge.success" || !reference) return c.text("OK", 200);

    try {
      const result = await deps.payments.confirm(reference);
      log.info(`Paystack webhook for ${reference}: ${result}`);
      return c.text("OK", 200);
    } catch (err) {
      // Not a 200, so Paystack tries again later.
      log.error(`Paystack webhook for ${reference} failed:`, err);
      return c.text("Try again", 500);
    }
  });

  // Flutterwave sends back the secret hash we set in its dashboard. Checked
  // before anything else; then, as with Paystack, the payment is confirmed by
  // asking Flutterwave, and confirm() acts on each payment only once.
  app.post("/webhooks/flutterwave", async (c) => {
    if (!deps.flutterwaveHash || !isValidFlutterwaveHash(c.req.header("verif-hash"), deps.flutterwaveHash)) {
      log.warn("Rejected Flutterwave webhook with an invalid hash");
      return c.text("Invalid signature", 401);
    }
    let body: { event?: string; data?: { tx_ref?: string; status?: string } };
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return c.text("Invalid JSON", 400);
    }
    const reference = body.data?.tx_ref;
    if (body.event !== "charge.completed" || !reference || !REFERENCE.test(reference)) return c.text("OK", 200);
    try {
      const result = await deps.payments.confirm(reference);
      log.info(`Flutterwave webhook for ${reference}: ${result}`);
      return c.text("OK", 200);
    } catch (err) {
      log.error(`Flutterwave webhook for ${reference} failed:`, err);
      return c.text("Try again", 500);
    }
  });

  app.get("/payments/done", async (c) => {
    // Paystack adds ?reference=..., Flutterwave ?tx_ref=...
    const reference = c.req.query("reference") ?? c.req.query("tx_ref") ?? "";
    let result: ConfirmResult | "error" = "not-paid";
    if (REFERENCE.test(reference)) {
      try {
        result = await deps.payments.confirm(reference);
      } catch (err) {
        log.error(`Checking payment ${reference} after redirect failed:`, err);
        result = "error";
      }
    }
    const ok = result === "paid" || result === "already-paid";
    const message = ok
      ? "Payment received, thank you. You can go back to WhatsApp; we've sent you a message there."
      : result === "error"
        ? "We couldn't check your payment just now. If you paid, it will be confirmed on WhatsApp shortly."
        : "This payment wasn't completed. Go back to WhatsApp to try again.";
    // Flutterwave payers are paying in CFA francs, so they also get it in French.
    const french = c.req.query("tx_ref")
      ? ok
        ? "Paiement reçu, merci. Vous pouvez retourner sur WhatsApp ; nous vous y avons écrit."
        : result === "error"
          ? "Nous n'avons pas pu vérifier votre paiement pour l'instant. Si vous avez payé, il sera confirmé sur WhatsApp sous peu."
          : "Ce paiement n'a pas abouti. Retournez sur WhatsApp pour réessayer."
      : "";
    return c.html(
      `<!doctype html><html lang="${french ? "fr" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;font-size:1.1rem;line-height:1.5">${french ? `<p>${french}</p>` : ""}<p>${message}</p></body></html>`,
    );
  });

  return app;
}

import { Hono } from "hono";
import { isValidWebhookHash } from "./flutterwave.js";
import type { ConfirmResult, Payments } from "./payments.js";

export interface PaymentRoutesDeps {
  payments: Payments;
  /** The secret hash typed into Flutterwave > Settings > Webhooks. */
  webhookHash: string;
  log?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * Two routes:
 * - POST /webhooks/flutterwave: Flutterwave tells us a payment finished.
 * - GET /payments/done: where the payer's browser lands after paying. It
 *   checks the payment too, so the plan switches on even if the webhook is late.
 */
export function createPaymentRoutes(deps: PaymentRoutesDeps) {
  const log = deps.log ?? console;
  const app = new Hono();

  app.post("/webhooks/flutterwave", async (c) => {
    if (!isValidWebhookHash(c.req.header("verif-hash"), deps.webhookHash)) {
      log.warn("Rejected Flutterwave webhook with a wrong verif-hash");
      return c.text("Invalid signature", 401);
    }

    let body: { event?: string; data?: { id?: number | string } };
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return c.text("Invalid JSON", 400);
    }
    if (body.event !== "charge.completed" || body.data?.id === undefined) return c.text("OK", 200);

    try {
      const result = await deps.payments.confirm(String(body.data.id));
      log.info(`Flutterwave webhook for transaction ${body.data.id}: ${result}`);
      return c.text("OK", 200);
    } catch (err) {
      // Not a 200, so Flutterwave tries again later (if retries are on).
      log.error(`Flutterwave webhook for transaction ${body.data.id} failed:`, err);
      return c.text("Try again", 500);
    }
  });

  app.get("/payments/done", async (c) => {
    const id = c.req.query("transaction_id");
    let result: ConfirmResult | "error" = "not-paid";
    if (id && /^\d+$/.test(id)) {
      try {
        result = await deps.payments.confirm(id);
      } catch (err) {
        log.error(`Checking payment ${id} after redirect failed:`, err);
        result = "error";
      }
    }
    const paid = result === "paid" || result === "already-paid";
    const message = paid
      ? "Payment received, thank you! You can go back to WhatsApp now; we've sent you a message there."
      : result === "error"
        ? "We couldn't check your payment just now. If you paid, it will be confirmed on WhatsApp shortly."
        : "This payment wasn't completed. Go back to WhatsApp to try again.";
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;font-size:1.1rem;line-height:1.5">` +
        `<p>${paid ? "✅" : "ℹ️"} ${message}</p></body></html>`,
    );
  });

  return app;
}

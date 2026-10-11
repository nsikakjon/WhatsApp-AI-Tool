import { Hono } from "hono";
import { createPaymentRoutes, type PaymentRoutesDeps } from "./core/payments/webhook.js";
import { createWhatsAppWebhook, type WebhookDeps } from "./core/whatsapp/webhook.js";

/** `payments` is only passed when Flutterwave is switched on. */
export function createApp(deps: WebhookDeps, payments?: PaymentRoutesDeps) {
  const app = new Hono();

  // Simple "is it running?" check for Railway and for you in a browser.
  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/webhooks/whatsapp", createWhatsAppWebhook(deps));
  if (payments) app.route("/", createPaymentRoutes(payments));

  return app;
}

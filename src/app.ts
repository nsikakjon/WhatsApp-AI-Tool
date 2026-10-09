import { Hono } from "hono";
import { createWhatsAppWebhook, type WebhookDeps } from "./core/whatsapp/webhook.js";

export function createApp(deps: WebhookDeps) {
  const app = new Hono();

  // Simple "is it running?" check for Railway and for you in a browser.
  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/webhooks/whatsapp", createWhatsAppWebhook(deps));

  return app;
}

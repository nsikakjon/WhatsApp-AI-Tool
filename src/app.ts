import { Hono } from "hono";
import { createInbox, type InboxDeps } from "./core/inbox/routes.js";
import { createWhatsAppWebhook, type WebhookDeps } from "./core/whatsapp/webhook.js";

export function createApp(deps: WebhookDeps, extras: { inbox?: InboxDeps } = {}) {
  const app = new Hono();

  // Simple "is it running?" check for Railway and for you in a browser.
  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/webhooks/whatsapp", createWhatsAppWebhook(deps));

  // The staff inbox web page, only when INBOX_PASSWORD is set.
  if (extras.inbox) app.route("/inbox", createInbox(extras.inbox));

  return app;
}

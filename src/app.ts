import { Hono } from "hono";
import { createWhatsAppWebhook, type WebhookDeps } from "./core/whatsapp/webhook.js";
import { createDashboard, type DashboardDeps } from "./dashboard/index.js";
import { createInstagramWebhook, type InstagramWebhookDeps } from "./instagram/webhook.js";

export function createApp(deps: WebhookDeps, dashboard?: DashboardDeps, instagram?: InstagramWebhookDeps) {
  const app = new Hono();

  // Simple "is it running?" check for Railway and for you in a browser.
  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/webhooks/whatsapp", createWhatsAppWebhook(deps));

  // The owner's analytics page; switched off unless DASHBOARD_PASSWORD is set.
  if (dashboard) app.route("/dashboard", createDashboard(dashboard));

  // Instagram comment auto-reply; switched off unless INSTAGRAM_AUTOREPLY is on.
  if (instagram) app.route("/webhooks/instagram", createInstagramWebhook(instagram));

  return app;
}

import { Hono } from "hono";
import { createWhatsAppWebhook, type WebhookDeps } from "./core/whatsapp/webhook.js";
import { createDashboard, type DashboardDeps } from "./dashboard/index.js";
import { createSignup, type SignupDeps } from "./signup/index.js";

export function createApp(deps: WebhookDeps, dashboard?: DashboardDeps, signup?: SignupDeps) {
  const app = new Hono();

  // Simple "is it running?" check for Railway and for you in a browser.
  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/webhooks/whatsapp", createWhatsAppWebhook(deps));

  // The owner's analytics page; switched off unless DASHBOARD_PASSWORD is set.
  if (dashboard) app.route("/dashboard", createDashboard(dashboard));

  // Where a business connects its WhatsApp number; switched off unless SIGNUP_PASSWORD is set.
  if (signup) app.route("/signup", createSignup(signup));

  return app;
}

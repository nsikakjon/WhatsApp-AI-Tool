import { Hono } from "hono";
import { createWhatsAppWebhook, type WebhookDeps } from "./core/whatsapp/webhook.js";
import { createDashboard, type DashboardDeps } from "./dashboard/index.js";
import { createReplyGenerator, type GeneratorDeps } from "./generator/index.js";
import { createVisitCounter, type VisitCounterDeps } from "./dashboard/visits.js";
import { createInstagramWebhook, type InstagramWebhookDeps } from "./instagram/webhook.js";

export function createApp(
  deps: WebhookDeps,
  dashboard?: DashboardDeps,
  visits?: VisitCounterDeps,
  generator?: GeneratorDeps,
  instagram?: InstagramWebhookDeps,
) {
  const app = new Hono();

  // Simple "is it running?" check for Railway and for you in a browser.
  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/webhooks/whatsapp", createWhatsAppWebhook(deps));

  // The owner's analytics page; switched off unless DASHBOARD_PASSWORD is set.
  if (dashboard) app.route("/dashboard", createDashboard(dashboard));

  // The yarnoga.com visitor counter: each page of the site reports a view here.
  if (visits) app.route("/views", createVisitCounter(visits));

  // The free reply generator on yarnoga.com; switched off unless REPLY_GENERATOR_ENABLED is set.
  if (generator) app.route("/tools/reply-generator", createReplyGenerator(generator));

  // Instagram comment auto-reply; switched off unless INSTAGRAM_AUTOREPLY is on.
  if (instagram) app.route("/webhooks/instagram", createInstagramWebhook(instagram));

  return app;
}

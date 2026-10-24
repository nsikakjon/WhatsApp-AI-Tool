import { Hono } from "hono";
import { createInbox, type InboxDeps } from "./core/inbox/routes.js";
import { createWhatsAppWebhook, type WebhookDeps } from "./core/whatsapp/webhook.js";
import { createDashboard, type DashboardDeps } from "./dashboard/index.js";
import { createSignup, type SignupDeps } from "./signup/index.js";
import { createReplyGenerator, type GeneratorDeps } from "./generator/index.js";
import { createVisitCounter, type VisitCounterDeps } from "./dashboard/visits.js";
import { createPaymentRoutes, type PaymentRoutesDeps } from "./core/payments/routes.js";
import { createQuoteSetup, type QuoteSetupDeps } from "./products/quote/setup.js";
import { createTracking, type TrackingDeps } from "./products/quote/delivery/tracking.js";
import { createOrderBoard, type BoardDeps } from "./products/quote/board.js";
import { createWalkInScreens, type ScreenDeps } from "./products/quote/walkin/screens.js";

export function createApp(
  deps: WebhookDeps,
  dashboard?: DashboardDeps,
  visits?: VisitCounterDeps,
  generator?: GeneratorDeps,
  signup?: SignupDeps,
  inbox?: InboxDeps,
  payments?: PaymentRoutesDeps,
  quoteSetup?: QuoteSetupDeps,
  tracking?: TrackingDeps,
  orderBoard?: BoardDeps,
  walkInScreens?: ScreenDeps,
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

  // Where a business connects its WhatsApp number; switched off unless SIGNUP_PASSWORD is set.
  if (signup) app.route("/signup", createSignup(signup));

  // The staff inbox web page, only when INBOX_PASSWORD is set.
  if (inbox) app.route("/inbox", createInbox(inbox));

  // Paystack's webhook and the page payers return to, only when PAYSTACK_SECRET_KEY is set.
  if (payments) app.route("/", createPaymentRoutes(payments));

  // The quote bot's owner setup screen; switched off unless QUOTE_SETUP_PASSWORD is set.
  if (quoteSetup) app.route("/quote-setup", createQuoteSetup(quoteSetup));

  // Delivery tracking pages for riders and customers, only when QUOTE_DELIVERY is on.
  if (tracking) app.route("/", createTracking(tracking));

  // Each quote business's orders page, behind its own signed link; only when QUOTE_ORDER_BOARD is on.
  if (orderBoard) app.route("/", createOrderBoard(orderBoard));

  // Kitchen and bar screens and receipt QR codes for walk-in orders; only when QUOTE_WALK_IN is on.
  if (walkInScreens) app.route("/", createWalkInScreens(walkInScreens));

  return app;
}

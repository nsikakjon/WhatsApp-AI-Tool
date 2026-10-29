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
import { createHealthRoutes, type HealthDeps } from "./core/health.js";
import { createOwnerApp, type OwnerAppDeps } from "./owner/index.js";
import { createCompliance, type ComplianceDeps } from "./compliance/index.js";

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
  more: {
    /** Checks behind /health/full and /status. Without them, /health alone. */
    health?: HealthDeps;
    /** The owners' and staff web app at /home (OWNER_APP). */
    ownerApp?: OwnerAppDeps;
    /** Jay's business verification page at /compliance (COMPLIANCE_PASSWORD). */
    compliance?: ComplianceDeps;
  } = {},
) {
  const app = new Hono();

  // Simple "is it running?" check for Railway and for you in a browser, plus
  // the full checks and status page when they're set up.
  if (more.health) app.route("/", createHealthRoutes(more.health));
  else app.get("/health", (c) => c.json({ ok: true }));

  app.route("/webhooks/whatsapp", createWhatsAppWebhook(deps));

  // The owner's analytics page; switched off unless DASHBOARD_PASSWORD is set.
  if (dashboard) app.route("/dashboard", createDashboard(dashboard));

  // The yarnoga.com visitor counter: each page of the site reports a view here.
  if (visits) app.route("/views", createVisitCounter(visits));

  // The free reply generator on yarnoga.com; switched off unless REPLY_GENERATOR_ENABLED is set.
  if (generator) app.route("/tools/reply-generator", createReplyGenerator(generator));

  // Where a business connects its WhatsApp number; switched off unless META_SIGNUP_CONFIG_ID is set.
  if (signup) app.route("/signup", createSignup(signup));

  // The staff inbox web page, only when INBOX_PASSWORD is set.
  if (inbox) app.route("/inbox", createInbox(inbox));

  // Paystack's and Flutterwave's webhooks and the page payers return to, only when PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY is set.
  if (payments) app.route("/", createPaymentRoutes(payments));

  // The quote bot's owner setup screen; switched off unless QUOTE_SETUP_PASSWORD is set.
  if (quoteSetup) app.route("/quote-setup", createQuoteSetup(quoteSetup));

  // Delivery tracking pages for riders and customers, only when QUOTE_DELIVERY is on.
  if (tracking) app.route("/", createTracking(tracking));

  // Each quote business's orders page, behind its own signed link; only when QUOTE_ORDER_BOARD is on.
  if (orderBoard) app.route("/", createOrderBoard(orderBoard));

  // Kitchen and bar screens and receipt QR codes for walk-in orders; only when QUOTE_WALK_IN is on.
  if (walkInScreens) app.route("/", createWalkInScreens(walkInScreens));

  // The owners' and staff web app (app.yarnoga.com), only when OWNER_APP is on.
  if (more.ownerApp) {
    app.get("/home/", (c) => c.redirect("/home", 301));
    app.route("/home", createOwnerApp(more.ownerApp));
    // The app used to live at /app; links already sent on WhatsApp still work.
    app.get("/app/*", (c) => {
      const url = new URL(c.req.url);
      return c.redirect(`/home${url.pathname.slice(4)}${url.search}`, 301);
    });
    app.get("/app", (c) => c.redirect("/home", 301));
    // app.yarnoga.com on its own opens the app.
    app.get("/", (c) => (new URL(c.req.url).hostname.startsWith("app.") ? c.redirect("/home", 302) : c.notFound()));
  }

  if (more.compliance) app.route("/compliance", createCompliance(more.compliance));

  return app;
}

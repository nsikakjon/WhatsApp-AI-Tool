import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSupabaseStore } from "./core/db/store.js";
import { createSupabaseInboxStore } from "./core/inbox/store.js";
import { createGroqTranscriber } from "./core/voice/transcribe.js";
import { createWhatsAppClient } from "./core/whatsapp/client.js";
import type { Product } from "./core/product.js";
import { echoProduct } from "./products/echo/index.js";
import { createQuoteProduct } from "./products/quote/index.js";
import {
  createSupabaseBranding,
  createSupabaseBusinesses,
  createSupabaseCatalog,
  createSupabaseOrders,
  createSupabaseSetup,
  DEFAULT_BUSINESS_ID,
} from "./products/quote/store.js";
import { createQuoteRouter } from "./products/quote/businesses.js";
import { createClaudeUnderstander } from "./products/quote/understand.js";
import { createClaudeDrafter } from "./products/quote/drafter.js";
import { createPlanGate, createSupabasePlanStore } from "./products/quote/plan.js";
import { createPlanFeatures, createSupabaseFeatureStore } from "./products/quote/features.js";
import { createAiCredits, createSupabaseCreditStore } from "./products/quote/credits.js";
import { createSiteReporter } from "./products/site/index.js";
import { createSupabaseSiteStore } from "./products/site/store.js";
import { createClaudeSummariser } from "./products/site/summarise.js";
import { createLeadQualifier } from "./products/leads/index.js";
import { createSupabaseLeadStore } from "./products/leads/store.js";
import { createClaudeLeadUnderstander } from "./products/leads/understand.js";
import { runEvery } from "./core/schedule.js";
import { createTestBots } from "./bottest/bots.js";
import { loadBotTestConfig } from "./bottest/config.js";
import { createBotTest } from "./bottest/index.js";
import { createSupabaseMarkStore } from "./bottest/store.js";
import {
  canMessageFreely,
  sendAndRecord,
  sendImageAndRecord,
  sendTemplateAndRecord,
} from "./core/whatsapp/outbox.js";
import { createFlyerBot, forwardTip } from "./products/flyer/index.js";
import { createSupabaseFlyerStore } from "./products/flyer/store.js";
import { createWishWriter } from "./products/flyer/wish.js";
import { TRIAL } from "./products/flyer/plans.js";
import { createSupabaseStats } from "./dashboard/stats.js";
import { createSocials } from "./dashboard/socials.js";
import { createSupabaseConnectionStore } from "./signup/store.js";
import { createSupabaseVisitStore, createSupabaseWebsiteStats } from "./dashboard/visits.js";
import { createClaudeGeneratorWriter } from "./generator/index.js";
import { createPaystackClient } from "./core/payments/paystack.js";
import { createPayments, type PaidHandler } from "./core/payments/payments.js";
import { createSupabasePaymentStore } from "./core/payments/store.js";

const config = loadConfig();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

// With QUOTE_MULTI_BUSINESS on, business #1 (the main number) only sees its
// own price list and orders. With it off, nothing looks at businesses at all.
const quoteBusinesses = config.quoteBusinesses;
const mainBusinessId = quoteBusinesses ? DEFAULT_BUSINESS_ID : undefined;

// Plan features (AI credits, voice notes, invoices), only with
// QUOTE_PLAN_FEATURES on. Business #1 always counts AI use under its fixed id.
function planFeatures(businessId: string, code?: string) {
  if (!config.quotePlanFeatures) return {};
  const features = createPlanFeatures({ code, store: createSupabaseFeatureStore(supabase, businessId) });
  return { features, credits: createAiCredits({ features, store: createSupabaseCreditStore(supabase, businessId) }) };
}

let product: Product = echoProduct;
if (config.activeProduct === "quote" && config.quote) {
  product = createQuoteProduct({
    businessName: config.quote.businessName,
    orderPrefix: config.quote.orderPrefix,
    ownerWaId: config.quote.ownerWaId,
    businessDetails: config.quote.businessDetails,
    paymentDetails: config.quote.paymentDetails,
    branding: createSupabaseBranding(supabase, mainBusinessId),
    catalog: createSupabaseCatalog(supabase, mainBusinessId),
    orders: createSupabaseOrders(supabase, mainBusinessId),
    plan: config.quote.plan
      ? createPlanGate({ code: config.quote.plan, store: createSupabasePlanStore(supabase, mainBusinessId) })
      : undefined,
    // Business #1 has no plan_code to fall back on: no QUOTE_PLAN, no plan features.
    ...(config.quote.plan ? planFeatures(DEFAULT_BUSINESS_ID, config.quote.plan) : {}),
    ai: createClaudeUnderstander({
      apiKey: config.quote.anthropicApiKey,
      model: config.quote.model,
      businessName: config.quote.businessName,
      description: config.quote.businessDescription,
    }),
  });
}

// Other businesses on the quote bot each answer their own WhatsApp number.
if (quoteBusinesses) {
  product = createQuoteRouter({
    businesses: createSupabaseBusinesses(supabase),
    fallback: product,
    fallbackNumberIds: [config.whatsapp.phoneNumberId],
    build: (business) =>
      createQuoteProduct({
        businessName: business.name,
        orderPrefix: business.orderPrefix,
        ownerWaId: business.ownerWaId ?? undefined,
        businessDetails: business.businessDetails ?? undefined,
        paymentDetails: business.paymentDetails ?? undefined,
        branding: createSupabaseBranding(supabase, business.id),
        catalog: createSupabaseCatalog(supabase, business.id),
        orders: createSupabaseOrders(supabase, business.id),
        plan: createPlanGate({ store: createSupabasePlanStore(supabase, business.id) }),
        ...planFeatures(business.id),
        ai: createClaudeUnderstander({
          apiKey: quoteBusinesses.anthropicApiKey,
          model: quoteBusinesses.model,
          businessName: business.name,
          description: business.description ?? undefined,
        }),
      }),
  });
}

// The site reporter answers its own WhatsApp number (SITE_PHONE_NUMBER_ID).
const siteConfig = config.site;
const siteReporter = siteConfig
  ? createSiteReporter({
      store: createSupabaseSiteStore(supabase),
      ai: createClaudeSummariser({ apiKey: siteConfig.anthropicApiKey, model: siteConfig.model }),
      reportHour: siteConfig.reportHour,
    })
  : undefined;

// The lead qualifier answers its own WhatsApp number (LEADS_PHONE_NUMBER_ID).
const leadsConfig = config.leads;
const leadQualifier = leadsConfig
  ? createLeadQualifier({
      store: createSupabaseLeadStore(supabase),
      ai: createClaudeLeadUnderstander({
        apiKey: leadsConfig.anthropicApiKey,
        model: leadsConfig.model,
        businessName: leadsConfig.businessName,
      }),
      businessName: leadsConfig.businessName,
      agentWaIds: leadsConfig.agentWaIds,
    })
  : undefined;

const store = createSupabaseStore(supabase);
const whatsapp = createWhatsAppClient(config.whatsapp);

// Paystack checkout links, when PAYSTACK_SECRET_KEY is set. Each product that
// sells something adds what happens once it's paid, and the WhatsApp number
// its messages about the payment come from.
const paidHandlers: Record<string, PaidHandler> = {};
const productNumbers: Record<string, string> = {};
const paystackConfig = config.paystack;
const payments = paystackConfig
  ? createPayments({
      paystack: createPaystackClient(paystackConfig),
      store: createSupabasePaymentStore(supabase),
      callbackUrl: `${paystackConfig.publicUrl}/payments/done`,
      customerEmail: paystackConfig.customerEmail,
      onPaid: paidHandlers,
      send: (product, to, text) => sendAndRecord({ store, whatsapp }, to, text, productNumbers[product]),
    })
  : undefined;

// The flyer bot answers its own WhatsApp number (FLYER_PHONE_NUMBER_ID).
const flyerConfig = config.flyer;
const flyerBot = flyerConfig
  ? createFlyerBot({
      store: createSupabaseFlyerStore(supabase),
      wishes: createWishWriter({ apiKey: flyerConfig.anthropicApiKey, model: flyerConfig.model }),
      owners: flyerConfig.ownerWaIds,
      openSignup: flyerConfig.openSignup,
      brandName: flyerConfig.brandName,
      credit: flyerConfig.credit,
      sendHour: flyerConfig.sendHour,
      trial: TRIAL,
      payments,
    })
  : undefined;
if (flyerBot && flyerConfig) {
  paidHandlers.flyer = flyerBot.planPaid;
  productNumbers.flyer = flyerConfig.phoneNumberId;
}

// Our WhatsApp numbers as the staff inbox labels them, main number first.
const numbers = [
  { id: config.whatsapp.phoneNumberId, label: config.activeProduct === "quote" ? "Sales" : "Main" },
  ...(siteConfig ? [{ id: siteConfig.phoneNumberId, label: "Site reports" }] : []),
  ...(leadsConfig ? [{ id: leadsConfig.phoneNumberId, label: "Property leads" }] : []),
  ...(flyerConfig ? [{ id: flyerConfig.phoneNumberId, label: "Flyers" }] : []),
];

const app = createApp({
  verifyToken: config.whatsapp.verifyToken,
  appSecret: config.whatsapp.appSecret,
  store,
  whatsapp,
  transcriber: config.groq ? createGroqTranscriber(config.groq) : undefined,
  ownerReplyPauseMinutes: config.ownerReplyPauseMinutes,
  route: (msg) => {
    if (siteReporter && msg.businessNumberId === siteConfig?.phoneNumberId) return siteReporter;
    if (leadQualifier && msg.businessNumberId === leadsConfig?.phoneNumberId) return leadQualifier;
    if (flyerBot && msg.businessNumberId === flyerConfig?.phoneNumberId) return flyerBot;
    return product;
  },
}, config.dashboard
  ? {
      password: config.dashboard.password,
      stats: createSupabaseStats(supabase),
      website: createSupabaseWebsiteStats(supabase),
      socials: createSocials({
        meta: config.dashboard.meta && { ...config.dashboard.meta, graphApiVersion: config.whatsapp.graphApiVersion },
        youtube: config.dashboard.youtube,
        tiktok: config.dashboard.tiktok,
      }),
      tiktokApp: config.dashboard.tiktok,
    }
  : undefined, {
  store: createSupabaseVisitStore(supabase),
  // Reuses an existing server secret to scramble the daily visitor code.
  secret: config.whatsapp.appSecret,
}, config.generator
  ? {
      writer: createClaudeGeneratorWriter({
        apiKey: config.generator.anthropicApiKey,
        model: config.generator.model,
      }),
      origins: config.generator.origins,
      perVisitorDailyLimit: config.generator.perVisitorDailyLimit,
      dailyLimit: config.generator.dailyLimit,
    }
  : undefined, config.signup
  ? {
      password: config.signup.password,
      app: {
        appId: config.signup.appId,
        appSecret: config.whatsapp.appSecret,
        graphApiVersion: config.whatsapp.graphApiVersion,
      },
      configId: config.signup.configId,
      store: createSupabaseConnectionStore(supabase),
    }
  : undefined, config.inbox
  ? {
      password: config.inbox.password,
      appSecret: config.whatsapp.appSecret,
      inbox: createSupabaseInboxStore(supabase),
      messages: store,
      whatsapp,
      numbers,
    }
  : undefined, payments && paystackConfig ? { payments, secretKey: paystackConfig.secretKey } : undefined, config.quoteSetup
  ? {
      password: config.quoteSetup.password,
      businesses: createSupabaseBusinesses(supabase),
      setup: createSupabaseSetup(supabase),
      // Numbers that already answer for something else can't be given to a business.
      reservedNumberIds: [
        config.whatsapp.phoneNumberId,
        config.site?.phoneNumberId,
        config.leads?.phoneNumberId,
        config.flyer?.phoneNumberId,
      ].filter((id): id is string => Boolean(id)),
      multiBusinessOn: Boolean(quoteBusinesses),
      drafter: config.quoteSetup.aiDraft
        ? createClaudeDrafter({ apiKey: config.quoteSetup.aiDraft.anthropicApiKey, model: config.quoteSetup.aiDraft.model })
        : undefined,
      draftsPerDay: config.quoteSetup.aiDraft?.perDay,
    }
  : undefined);

// Every 5 minutes, send any daily site reports that are due.
if (siteReporter && siteConfig) {
  runEvery(5 * 60 * 1000, async () => {
    for (const report of await siteReporter.dueReports(new Date())) {
      try {
        await sendAndRecord({ store, whatsapp }, report.to, report.text, siteConfig.phoneNumberId);
      } catch (err) {
        console.error(`Failed to send daily site report to ...${report.to.slice(-4)}:`, err);
      }
    }
  });
}

// The owner test screen at /bot-test (BOT_TEST_PASSWORD): try a bot on common
// customer questions before it goes live. It never sends WhatsApp messages.
const botTest = loadBotTestConfig();
if (botTest.status === "weak") console.warn("Bot test screen is OFF: BOT_TEST_PASSWORD must be at least 12 characters");
if (botTest.status === "on") {
  app.route(
    "/bot-test",
    createBotTest({
      password: botTest.password,
      dailyLimit: botTest.dailyLimit,
      bots: createTestBots(supabase, config),
      marks: createSupabaseMarkStore(supabase),
    }),
  );
  console.log("Bot test screen: on at /bot-test");
}

// Every 5 minutes, send any birthday flyers that are due to group admins.
// An admin who messaged the bot in the last day gets the flyer with its
// message and a forwarding tip. Anyone else gets the approved template (if
// set up), or the flyer waits until they next message the bot that day.
if (flyerBot && flyerConfig) {
  const deps = { store, whatsapp };
  const from = flyerConfig.phoneNumberId;
  const template = flyerConfig.template;
  runEvery(5 * 60 * 1000, () =>
    flyerBot.sendDueBirthdays(new Date(), {
      canReach: async (to) => template !== undefined || (await canMessageFreely(store, to)),
      send: async (d) => {
        const image = { data: d.flyer, mimeType: "image/jpeg" };
        if (await canMessageFreely(store, d.to)) {
          await sendImageAndRecord(deps, d.to, { ...image, caption: d.wish }, from);
          await sendAndRecord(deps, d.to, forwardTip([d.memberName], d.groupName), from);
        } else if (template) {
          await sendTemplateAndRecord(
            deps,
            d.to,
            { ...template, headerImage: image, bodyParams: [d.memberName, d.groupName, d.wish] },
            from,
          );
        } else {
          throw new Error("admin hasn't messaged the bot in the last day and no template is set");
        }
      },
    }),
  );
}

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `Server listening on port ${info.port} (product: ${product.name}, more quote businesses: ${quoteBusinesses ? "on" : "off"}, site reporter: ${siteReporter ? "on" : "off"}, lead qualifier: ${leadQualifier ? "on" : "off"}, flyers: ${flyerBot ? "on" : "off"}, voice notes: ${config.groq ? "on" : "off"}, dashboard: ${config.dashboard ? "on" : "off"}, reply generator: ${config.generator ? "on" : "off"}, sign-up page: ${config.signup ? "on" : "off"}, owner-reply pause: ${config.ownerReplyPauseMinutes} min, inbox: ${config.inbox ? "on" : "off"}, payments: ${paystackConfig ? (paystackConfig.secretKey.startsWith("sk_live_") ? "Paystack live" : "Paystack test") : "off"}, quote setup screen: ${config.quoteSetup ? "on" : "off"})`,
  );
});

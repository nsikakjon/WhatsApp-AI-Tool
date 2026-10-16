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
  DEFAULT_BUSINESS_ID,
} from "./products/quote/store.js";
import { createQuoteRouter } from "./products/quote/businesses.js";
import { createSupabaseBroadcasts } from "./products/quote/broadcast-store.js";
import { finishedText, sendDueBroadcasts, withBroadcasts } from "./products/quote/broadcasts.js";
import type { OutgoingImage, OutgoingTemplate } from "./core/whatsapp/client.js";
import { createClaudeUnderstander } from "./products/quote/understand.js";
import { createSiteReporter } from "./products/site/index.js";
import { createSupabaseSiteStore } from "./products/site/store.js";
import { createClaudeSummariser } from "./products/site/summarise.js";
import { createLeadQualifier } from "./products/leads/index.js";
import { createSupabaseLeadStore } from "./products/leads/store.js";
import { createClaudeLeadUnderstander } from "./products/leads/understand.js";
import { runEvery } from "./core/schedule.js";
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

const config = loadConfig();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

// With QUOTE_MULTI_BUSINESS on, business #1 (the main number) only sees its
// own price list and orders. With it off, nothing looks at businesses at all.
const quoteBusinesses = config.quoteBusinesses;
const mainBusinessId = quoteBusinesses ? DEFAULT_BUSINESS_ID : undefined;

// Broadcasts to opted-in customers (BROADCASTS_ENABLED). Off: the quote bot
// is exactly as before.
const broadcastConfig = config.broadcasts;
const broadcastStore = broadcastConfig ? createSupabaseBroadcasts(supabase) : undefined;
function addBroadcasts(bot: Product, businessId: string, businessName: string, ownerWaId: string | undefined): Product {
  if (!broadcastConfig || !broadcastStore) return bot;
  return withBroadcasts(bot, {
    businessId,
    businessName,
    ownerWaId,
    store: broadcastStore,
    monthlyLimit: (id) => broadcastStore.monthlyLimit(id),
    pictures: !!broadcastConfig.imageTemplateName,
    costPerMessageKobo: broadcastConfig.costPerMessageKobo,
  });
}

let product: Product = echoProduct;
if (config.activeProduct === "quote" && config.quote) {
  const quoteBot = createQuoteProduct({
    businessName: config.quote.businessName,
    orderPrefix: config.quote.orderPrefix,
    ownerWaId: config.quote.ownerWaId,
    businessDetails: config.quote.businessDetails,
    paymentDetails: config.quote.paymentDetails,
    branding: createSupabaseBranding(supabase, mainBusinessId),
    catalog: createSupabaseCatalog(supabase, mainBusinessId),
    orders: createSupabaseOrders(supabase, mainBusinessId),
    ai: createClaudeUnderstander({
      apiKey: config.quote.anthropicApiKey,
      model: config.quote.model,
      businessName: config.quote.businessName,
      description: config.quote.businessDescription,
    }),
  });
  product = addBroadcasts(quoteBot, DEFAULT_BUSINESS_ID, config.quote.businessName, config.quote.ownerWaId);
}

// Other businesses on the quote bot each answer their own WhatsApp number.
if (quoteBusinesses) {
  product = createQuoteRouter({
    businesses: createSupabaseBusinesses(supabase),
    fallback: product,
    fallbackNumberIds: [config.whatsapp.phoneNumberId],
    build: (business) =>
      addBroadcasts(createQuoteProduct({
        businessName: business.name,
        orderPrefix: business.orderPrefix,
        ownerWaId: business.ownerWaId ?? undefined,
        businessDetails: business.businessDetails ?? undefined,
        paymentDetails: business.paymentDetails ?? undefined,
        branding: createSupabaseBranding(supabase, business.id),
        catalog: createSupabaseCatalog(supabase, business.id),
        orders: createSupabaseOrders(supabase, business.id),
        ai: createClaudeUnderstander({
          apiKey: quoteBusinesses.anthropicApiKey,
          model: quoteBusinesses.model,
          businessName: business.name,
          description: business.description ?? undefined,
        }),
      }), business.id, business.name, business.ownerWaId ?? undefined),
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
    })
  : undefined;

const store = createSupabaseStore(supabase);
const whatsapp = createWhatsAppClient(config.whatsapp);

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

// Every minute, send the next few messages of any confirmed broadcasts.
if (broadcastConfig && broadcastStore) {
  const pictures = new Map<number, OutgoingImage>();
  runEvery(60 * 1000, () =>
    sendDueBroadcasts({
      store: broadcastStore,
      perRun: broadcastConfig.perMinute,
      send: async (to, b) => {
        let template: OutgoingTemplate = { ...broadcastConfig.template, bodyParams: [b.businessName, b.body] };
        if (b.imageMediaId && broadcastConfig.imageTemplateName) {
          let image = pictures.get(b.id);
          if (!image) {
            // The owner's photo: downloaded once per broadcast.
            const file = await whatsapp.downloadMedia(b.imageMediaId);
            image = { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: file.mimeType === "image/png" ? "image/png" : "image/jpeg" };
            pictures.set(b.id, image);
          }
          template = { ...template, name: broadcastConfig.imageTemplateName, headerImage: image };
        }
        const from = b.fromNumberId ?? undefined;
        const sent = await whatsapp.sendTemplate(to, template, from);
        try {
          const contactId = await store.upsertContact(to);
          await store.recordOutbound(contactId, {
            waMessageId: sent.waMessageId,
            type: "template",
            body: `[${template.name}] ${b.body}`,
            raw: sent.raw,
            businessNumberId: from,
          });
        } catch (err) {
          console.error("Broadcast sent but not saved to the chat history:", err);
        }
        return sent.waMessageId;
      },
      notifyOwner: async (b, tally) => {
        pictures.delete(b.id);
        try {
          await sendAndRecord({ store, whatsapp }, b.ownerWaId, finishedText(b, tally), b.fromNumberId ?? undefined);
        } catch (err) {
          // Most likely the owner hasn't messaged in the last day.
          console.error(`Broadcast ${b.id} finished but the owner couldn't be told:`, err);
        }
      },
    }),
  );
}

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `Server listening on port ${info.port} (product: ${product.name}, more quote businesses: ${quoteBusinesses ? "on" : "off"}, broadcasts: ${broadcastConfig ? "on" : "off"}, site reporter: ${siteReporter ? "on" : "off"}, lead qualifier: ${leadQualifier ? "on" : "off"}, flyers: ${flyerBot ? "on" : "off"}, voice notes: ${config.groq ? "on" : "off"}, dashboard: ${config.dashboard ? "on" : "off"}, reply generator: ${config.generator ? "on" : "off"}, sign-up page: ${config.signup ? "on" : "off"}, owner-reply pause: ${config.ownerReplyPauseMinutes} min, inbox: ${config.inbox ? "on" : "off"})`,
  );
});

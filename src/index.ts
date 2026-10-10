import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSupabaseStore } from "./core/db/store.js";
import { createGroqTranscriber } from "./core/voice/transcribe.js";
import { createWhatsAppClient } from "./core/whatsapp/client.js";
import type { Product } from "./core/product.js";
import { echoProduct } from "./products/echo/index.js";
import { createQuoteProduct } from "./products/quote/index.js";
import { createSupabaseCatalog, createSupabaseOrders } from "./products/quote/store.js";
import { createClaudeUnderstander } from "./products/quote/understand.js";
import { createSiteReporter } from "./products/site/index.js";
import { createSupabaseSiteStore } from "./products/site/store.js";
import { createClaudeSummariser } from "./products/site/summarise.js";
import { runEvery } from "./core/schedule.js";
import { sendAndRecord } from "./core/whatsapp/outbox.js";

const config = loadConfig();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

let product: Product = echoProduct;
if (config.activeProduct === "quote" && config.quote) {
  product = createQuoteProduct({
    businessName: config.quote.businessName,
    orderPrefix: config.quote.orderPrefix,
    ownerWaId: config.quote.ownerWaId,
    catalog: createSupabaseCatalog(supabase),
    orders: createSupabaseOrders(supabase),
    ai: createClaudeUnderstander({
      apiKey: config.quote.anthropicApiKey,
      model: config.quote.model,
      businessName: config.quote.businessName,
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

const store = createSupabaseStore(supabase);
const whatsapp = createWhatsAppClient(config.whatsapp);

const app = createApp({
  verifyToken: config.whatsapp.verifyToken,
  appSecret: config.whatsapp.appSecret,
  store,
  whatsapp,
  transcriber: config.groq ? createGroqTranscriber(config.groq) : undefined,
  route: (msg) =>
    siteReporter && msg.businessNumberId === siteConfig?.phoneNumberId ? siteReporter : product,
});

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

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `Server listening on port ${info.port} (product: ${product.name}, site reporter: ${siteReporter ? "on" : "off"}, voice notes: ${config.groq ? "on" : "off"})`,
  );
});

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

const app = createApp({
  verifyToken: config.whatsapp.verifyToken,
  appSecret: config.whatsapp.appSecret,
  store: createSupabaseStore(supabase),
  whatsapp: createWhatsAppClient(config.whatsapp),
  transcriber: config.groq ? createGroqTranscriber(config.groq) : undefined,
  route: () => product,
});

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `Server listening on port ${info.port} (product: ${product.name}, voice notes: ${config.groq ? "on" : "off"})`,
  );
});

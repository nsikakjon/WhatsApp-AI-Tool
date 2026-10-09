import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSupabaseStore } from "./core/db/store.js";
import { createWhatsAppClient } from "./core/whatsapp/client.js";
import { echoProduct } from "./products/echo/index.js";

const config = loadConfig();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

const app = createApp({
  verifyToken: config.whatsapp.verifyToken,
  appSecret: config.whatsapp.appSecret,
  store: createSupabaseStore(supabase),
  whatsapp: createWhatsAppClient(config.whatsapp),
  route: () => echoProduct,
});

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Server listening on port ${info.port}`);
});

// Reads settings from environment variables (.env locally, Variables on Railway).
// Fails fast at startup if anything required is missing, so a misconfigured
// deploy crashes loudly instead of silently ignoring messages.

export interface Config {
  port: number;
  whatsapp: {
    verifyToken: string;
    appSecret: string;
    accessToken: string;
    phoneNumberId: string;
    graphApiVersion: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  /** Voice note transcription. Unset when GROQ_API_KEY is missing (voice notes then aren't understood). */
  groq?: { apiKey: string; model: string };
  /** Which product answers messages: "echo" (test) or "quote" (quote and order bot). */
  activeProduct: "echo" | "quote";
  /** Only set when activeProduct is "quote". */
  quote?: {
    anthropicApiKey: string;
    model: string;
    businessName: string;
    orderPrefix: string;
    ownerWaId?: string;
  };
  /**
   * Construction site progress reporter. Only set when SITE_PHONE_NUMBER_ID is:
   * messages to that WhatsApp number go to the site reporter, and everything
   * else still goes to ACTIVE_PRODUCT.
   */
  site?: {
    phoneNumberId: string;
    anthropicApiKey: string;
    model: string;
    /** Lagos hour (0-23) when the daily report is sent. */
    reportHour: number;
  };
  /**
   * Birthday and event flyers for WhatsApp groups. Only set when
   * FLYER_PHONE_NUMBER_ID is: messages to that number go to the flyer bot.
   */
  flyer?: {
    phoneNumberId: string;
    /** WhatsApp numbers allowed to create groups. */
    ownerWaIds: string[];
    /** Lagos hour (0-23) from which birthday flyers go out. */
    sendHour: number;
    /** Writes the birthday messages. Without it, ready-made messages are used. */
    anthropicApiKey?: string;
    model: string;
    /** Approved WhatsApp template for flyers to admins who haven't messaged in 24 hours. */
    template?: { name: string; language: string };
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const activeProduct = env.ACTIVE_PRODUCT || "echo";
  if (activeProduct !== "echo" && activeProduct !== "quote") {
    throw new Error(`ACTIVE_PRODUCT must be "echo" or "quote" (got "${activeProduct}")`);
  }

  const reportHour = Number(env.SITE_REPORT_HOUR || 18);
  if (!Number.isInteger(reportHour) || reportHour < 0 || reportHour > 23) {
    throw new Error(`SITE_REPORT_HOUR must be a whole hour from 0 to 23 (got "${env.SITE_REPORT_HOUR}")`);
  }

  const flyerHour = Number(env.FLYER_SEND_HOUR || 8);
  if (!Number.isInteger(flyerHour) || flyerHour < 0 || flyerHour > 23) {
    throw new Error(`FLYER_SEND_HOUR must be a whole hour from 0 to 23 (got "${env.FLYER_SEND_HOUR}")`);
  }

  return {
    port: Number(env.PORT ?? 3000),
    whatsapp: {
      verifyToken: required(env, "WHATSAPP_VERIFY_TOKEN"),
      appSecret: required(env, "WHATSAPP_APP_SECRET"),
      accessToken: required(env, "WHATSAPP_ACCESS_TOKEN"),
      phoneNumberId: required(env, "WHATSAPP_PHONE_NUMBER_ID"),
      graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION || "v23.0",
    },
    supabase: {
      url: required(env, "SUPABASE_URL"),
      serviceRoleKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    },
    groq: env.GROQ_API_KEY
      ? { apiKey: env.GROQ_API_KEY, model: env.GROQ_WHISPER_MODEL || "whisper-large-v3" }
      : undefined,
    activeProduct,
    quote:
      activeProduct === "quote"
        ? {
            anthropicApiKey: required(env, "ANTHROPIC_API_KEY"),
            model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
            businessName: env.QUOTE_BUSINESS_NAME || "KahnPrints",
            orderPrefix: env.QUOTE_ORDER_PREFIX || "KP",
            ownerWaId: env.QUOTE_OWNER_WA_ID?.replace(/\D/g, "") || undefined,
          }
        : undefined,
    site: env.SITE_PHONE_NUMBER_ID
      ? {
          phoneNumberId: env.SITE_PHONE_NUMBER_ID,
          anthropicApiKey: required(env, "ANTHROPIC_API_KEY"),
          model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
          reportHour,
        }
      : undefined,
    flyer: env.FLYER_PHONE_NUMBER_ID
      ? {
          phoneNumberId: env.FLYER_PHONE_NUMBER_ID,
          ownerWaIds: required(env, "FLYER_OWNER_WA_IDS")
            .split(",")
            .map((n) => n.replace(/\D/g, ""))
            .filter(Boolean),
          sendHour: flyerHour,
          anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
          model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
          template: env.FLYER_TEMPLATE_NAME
            ? { name: env.FLYER_TEMPLATE_NAME, language: env.FLYER_TEMPLATE_LANGUAGE || "en" }
            : undefined,
        }
      : undefined,
  };
}

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
  };
}

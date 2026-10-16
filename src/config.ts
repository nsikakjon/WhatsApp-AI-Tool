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
    /** Address or phone printed under the business name on invoices and receipts. */
    businessDetails?: string;
    /** Bank details printed on invoices. */
    paymentDetails?: string;
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
   * Real estate lead qualifier. Only set when LEADS_PHONE_NUMBER_ID is:
   * messages to that WhatsApp number go to the lead qualifier.
   */
  leads?: {
    phoneNumberId: string;
    anthropicApiKey: string;
    model: string;
    businessName: string;
    /** WhatsApp numbers (digits only) of the agents who get hot-lead alerts. */
    agentWaIds: string[];
  };
  /**
   * Birthday and event flyers for WhatsApp groups. Only set when
   * FLYER_PHONE_NUMBER_ID is: messages to that number go to the flyer bot.
   */
  flyer?: {
    phoneNumberId: string;
    /** WhatsApp numbers that run the service: can always create groups, and hear about sign-ups. */
    ownerWaIds: string[];
    /** Let anyone set up a group of their own. */
    openSignup: boolean;
    /** The service's name, used when greeting new people. */
    brandName: string;
    /** Small print on every flyer. Empty for none. */
    credit: string;
    /** Lagos hour (0-23) from which birthday flyers go out. */
    sendHour: number;
    /** Writes the birthday messages. Without it, ready-made messages are used. */
    anthropicApiKey?: string;
    model: string;
    /** Approved WhatsApp template for flyers to admins who haven't messaged in 24 hours. */
    template?: { name: string; language: string };
  };
  /**
   * The owner's analytics page at /dashboard. Only set when DASHBOARD_PASSWORD
   * is: without a password the page is switched off.
   */
  dashboard?: {
    password: string;
    /** Instagram and Facebook numbers: a token that can read the Facebook Page, and the Page's id. */
    meta?: { token: string; pageId: string };
    /** YouTube channel numbers. */
    youtube?: { apiKey: string; handle: string };
    /** TikTok numbers. refreshToken is empty until the owner connects TikTok from the dashboard. */
    tiktok?: { clientKey: string; clientSecret: string; refreshToken?: string };
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value;
}

/** Lets a one-line Railway variable hold several lines, written with " | " between them. */
function multiline(value: string | undefined): string | undefined {
  const text = value?.split("|").map((part) => part.trim()).filter(Boolean).join("\n");
  return text || undefined;
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
            businessDetails: multiline(env.QUOTE_BUSINESS_DETAILS),
            paymentDetails: multiline(env.QUOTE_PAYMENT_DETAILS),
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
    leads: env.LEADS_PHONE_NUMBER_ID
      ? {
          phoneNumberId: env.LEADS_PHONE_NUMBER_ID,
          anthropicApiKey: required(env, "ANTHROPIC_API_KEY"),
          model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
          businessName: env.LEADS_BUSINESS_NAME || "our real estate team",
          agentWaIds: agentNumbers(required(env, "LEADS_AGENT_WA_IDS")),
        }
      : undefined,
    flyer: env.FLYER_PHONE_NUMBER_ID
      ? {
          phoneNumberId: env.FLYER_PHONE_NUMBER_ID,
          ownerWaIds: required(env, "FLYER_OWNER_WA_IDS")
            .split(",")
            .map((n) => n.replace(/\D/g, ""))
            .filter(Boolean),
          openSignup: !/^(false|no|off|0)$/i.test(env.FLYER_OPEN_SIGNUP ?? ""),
          brandName: env.FLYER_BRAND_NAME || "Flyer Bot",
          credit: env.FLYER_CREDIT ?? "",
          sendHour: flyerHour,
          anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
          model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
          template: env.FLYER_TEMPLATE_NAME
            ? { name: env.FLYER_TEMPLATE_NAME, language: env.FLYER_TEMPLATE_LANGUAGE || "en" }
            : undefined,
        }
      : undefined,
    dashboard: env.DASHBOARD_PASSWORD
      ? {
          password: env.DASHBOARD_PASSWORD,
          meta:
            env.META_SOCIAL_TOKEN && env.FACEBOOK_PAGE_ID
              ? { token: env.META_SOCIAL_TOKEN, pageId: env.FACEBOOK_PAGE_ID }
              : undefined,
          youtube: env.YOUTUBE_API_KEY
            ? { apiKey: env.YOUTUBE_API_KEY, handle: (env.YOUTUBE_HANDLE || "yarnoga").replace(/^@/, "") }
            : undefined,
          tiktok:
            env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET
              ? {
                  clientKey: env.TIKTOK_CLIENT_KEY,
                  clientSecret: env.TIKTOK_CLIENT_SECRET,
                  refreshToken: env.TIKTOK_REFRESH_TOKEN || undefined,
                }
              : undefined,
        }
      : undefined,
  };
}

/** "+234 801 234 5678, 2348098765432" -> ["2348012345678", "2348098765432"] */
function agentNumbers(list: string): string[] {
  const numbers = list.split(",").map((n) => n.replace(/\D/g, "")).filter(Boolean);
  if (!numbers.length) throw new Error("LEADS_AGENT_WA_IDS must list at least one WhatsApp number");
  return numbers;
}

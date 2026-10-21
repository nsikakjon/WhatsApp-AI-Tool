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
  /**
   * WhatsApp coexistence: minutes the bot stays quiet in a chat after the
   * owner replies from the WhatsApp Business app. 0 switches this off.
   */
  ownerReplyPauseMinutes: number;
  /** Staff inbox web page at /inbox. Unset (switched off) when INBOX_PASSWORD is missing. */
  inbox?: { password: string };
  /** Voice note transcription. Unset when GROQ_API_KEY is missing (voice notes then aren't understood). */
  groq?: { apiKey: string; model: string };
  /** Which product answers messages: "echo" (test) or "quote" (quote and order bot). */
  activeProduct: "echo" | "quote";
  /** Only set when activeProduct is "quote". */
  quote?: {
    anthropicApiKey: string;
    model: string;
    businessName: string;
    /** What the business does, e.g. "a print shop". Helps the AI understand customers. */
    businessDescription?: string;
    orderPrefix: string;
    ownerWaId?: string;
    /** Address or phone printed under the business name on invoices and receipts. */
    businessDetails?: string;
    /** Bank details printed on invoices. */
    paymentDetails?: string;
  };
  /**
   * More businesses on the quote bot, each on its own WhatsApp number, set up
   * in the quote_businesses table. Only set when QUOTE_MULTI_BUSINESS is true.
   */
  quoteBusinesses?: {
    anthropicApiKey: string;
    model: string;
  };
  /**
   * The owner setup screen at /quote-setup (businesses and price lists for
   * the quote bot). Only set when QUOTE_SETUP_PASSWORD is.
   */
  quoteSetup?: { password: string };
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
  /**
   * The free reply generator on the website. Only set when
   * REPLY_GENERATOR_ENABLED is true: otherwise the tool is switched off.
   */
  generator?: {
    anthropicApiKey: string;
    model: string;
    /** Website addresses allowed to use it. */
    origins: string[];
    perVisitorDailyLimit: number;
    dailyLimit: number;
  };
  /**
   * The sign-up page at /signup where a business connects its WhatsApp number
   * through Meta's pop-up (Embedded Signup), e.g. for coexistence. Only set
   * when SIGNUP_PASSWORD is: without a password the page is switched off.
   */
  signup?: {
    password: string;
    /** The Meta app's App ID (the same app as the webhook and WHATSAPP_APP_SECRET). */
    appId: string;
    /** The Facebook Login for Business configuration made for Embedded Signup. */
    configId: string;
  };
  /**
   * Online payments through Paystack. Only set when PAYSTACK_SECRET_KEY is:
   * without it, nothing is charged and owners take payment by hand.
   */
  paystack?: {
    secretKey: string;
    /** This server's public address, for the page payers return to. */
    publicUrl: string;
    /** Paystack needs an email on every payment; WhatsApp doesn't give us one. */
    customerEmail: string;
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

  const pauseMinutes = Number(env.OWNER_REPLY_PAUSE_MINUTES || 60);
  if (!Number.isInteger(pauseMinutes) || pauseMinutes < 0) {
    throw new Error(
      `OWNER_REPLY_PAUSE_MINUTES must be a whole number of minutes, 0 or more (got "${env.OWNER_REPLY_PAUSE_MINUTES}")`,
    );
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
    ownerReplyPauseMinutes: pauseMinutes,
    inbox: inboxSettings(env.INBOX_PASSWORD),
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
            businessDescription: env.QUOTE_BUSINESS_DESCRIPTION?.trim() || undefined,
            orderPrefix: env.QUOTE_ORDER_PREFIX || "KP",
            ownerWaId: env.QUOTE_OWNER_WA_ID?.replace(/\D/g, "") || undefined,
            businessDetails: multiline(env.QUOTE_BUSINESS_DETAILS),
            paymentDetails: multiline(env.QUOTE_PAYMENT_DETAILS),
          }
        : undefined,
    quoteBusinesses: /^(true|yes|on|1)$/i.test(env.QUOTE_MULTI_BUSINESS ?? "")
      ? { anthropicApiKey: required(env, "ANTHROPIC_API_KEY"), model: env.ANTHROPIC_MODEL || "claude-haiku-5-5" }
      : undefined,
    quoteSetup: env.QUOTE_SETUP_PASSWORD ? { password: longPassword(env, "QUOTE_SETUP_PASSWORD") } : undefined,
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
    generator: /^(true|yes|on|1)$/i.test(env.REPLY_GENERATOR_ENABLED ?? "")
      ? {
          anthropicApiKey: required(env, "ANTHROPIC_API_KEY"),
          model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
          origins: (env.REPLY_GENERATOR_ORIGINS || "https://yarnoga.com,https://www.yarnoga.com")
            .split(",")
            .map((o) => o.trim().replace(/\/+$/, ""))
            .filter(Boolean),
          perVisitorDailyLimit: wholeNumber(env, "REPLY_GENERATOR_VISITOR_LIMIT", 5),
          dailyLimit: wholeNumber(env, "REPLY_GENERATOR_DAILY_LIMIT", 200),
        }
      : undefined,
    signup: env.SIGNUP_PASSWORD
      ? {
          password: env.SIGNUP_PASSWORD,
          appId: required(env, "META_APP_ID"),
          configId: required(env, "META_SIGNUP_CONFIG_ID"),
        }
      : undefined,
    paystack: paystackSettings(env),
  };
}

function longPassword(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name] ?? "";
  if (value.length < 12) throw new Error(`${name} must be at least 12 characters long`);
  return value;
}

function paystackSettings(env: NodeJS.ProcessEnv): Config["paystack"] {
  const secretKey = env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return undefined;
  if (!/^sk_(test|live)_/.test(secretKey)) {
    throw new Error("PAYSTACK_SECRET_KEY must be the secret key (starts with sk_test_ or sk_live_), not the public key");
  }
  const publicUrl = required(env, "PUBLIC_URL").replace(/\/+$/, "");
  if (!publicUrl.startsWith("https://")) throw new Error(`PUBLIC_URL must start with https:// (got "${publicUrl}")`);
  return { secretKey, publicUrl, customerEmail: required(env, "PAYSTACK_CUSTOMER_EMAIL") };
}

function inboxSettings(password: string | undefined): Config["inbox"] {
  if (!password) return undefined;
  if (password.length < 12) throw new Error("INBOX_PASSWORD must be at least 12 characters long");
  return { password };
}

function wholeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a whole number above 0 (got "${env[name]}")`);
  }
  return value;
}

/** "+234 801 234 5678, 2348098765432" -> ["2348012345678", "2348098765432"] */
function agentNumbers(list: string): string[] {
  const numbers = list.split(",").map((n) => n.replace(/\D/g, "")).filter(Boolean);
  if (!numbers.length) throw new Error("LEADS_AGENT_WA_IDS must list at least one WhatsApp number");
  return numbers;
}

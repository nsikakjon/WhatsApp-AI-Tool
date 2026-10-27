import { isLang, type Lang } from "./core/i18n.js";
import { isCurrency, type Currency } from "./core/money.js";
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
  /**
   * Who hears about problems (errors, a check failing, the server not
   * answering) and how. Each part is optional; with none set nobody is told.
   */
  alerts: {
    /** Jay's WhatsApp number (digits only), ALERT_WA_ID. */
    waId?: string;
    /** Approved template with one body value ({{1}} = the alert) for when Jay hasn't messaged the bot in a day. */
    template?: { name: string; language: string };
    /** Email through Resend: RESEND_API_KEY, ALERT_EMAIL, ALERT_EMAIL_FROM. */
    email?: { apiKey: string; to: string; from: string };
    /** Sentry error tracking, SENTRY_DSN. */
    sentry?: { dsn: string; environment: string };
  };
  /**
   * The owners' and staff web app at /app (OWNER_APP=true): dashboard, inbox,
   * orders, price list, delivery, posters, exports and settings for each
   * quote business. Needs migration 0049.
   */
  ownerApp?: {
    publicUrl: string;
    /** Where the app's Help page sends people: SUPPORT_EMAIL and SUPPORT_WA_ID. */
    supportEmail: string;
    supportWaId?: string;
  };
  /**
   * The compliance page at /compliance where Jay checks businesses
   * (COMPLIANCE_PASSWORD, migration 0050), with optional CAC checks through
   * Dojah (DOJAH_APP_ID, DOJAH_SECRET_KEY; DOJAH_SANDBOX=true for test data).
   */
  compliance?: { password: string; dojah?: { appId: string; secretKey: string; sandbox: boolean } };
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
    /** The plan this business is on (a code in quote_plans, e.g. "free"). Unset = no plan limits. */
    plan?: string;
    /** Its Paystack subaccount (ACCT_...), where pay links on its invoices pay out. */
    paystackSubaccount?: string;
    /** Its Flutterwave subaccount (RS_...), where CFA franc pay links pay out. */
    flutterwaveSubaccount?: string;
    /** "en" or "fr": owner messages and invoices, and customers whose language isn't clear. */
    language: Lang;
    /** "NGN" (naira), "XOF" or "XAF" (CFA francs). */
    currency: Currency;
    /** Answer voice notes with a voice note (needs TTS set up). */
    voiceReplies: boolean;
    /** Offer Shipbubble couriers for addresses outside its zones (needs SHIPBUBBLE_API_KEY and pay links). */
    courierDelivery: boolean;
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
   * Delivery for the quote bot: address and fee before the order, riders sent
   * out from WhatsApp, and tracking pages. Only set when QUOTE_DELIVERY is true.
   */
  delivery?: {
    /** This server's public address, used in tracking links. */
    publicUrl: string;
    /** Approved template for delivery updates to people who haven't messaged in 24 hours. */
    template?: { name: string; language: string };
  };
  /**
   * The owner's orders page (order board and sales dashboard), sent as a
   * private link when the owner sends "orders". Only set when QUOTE_ORDER_BOARD is true.
   */
  quoteOrderBoard?: { publicUrl: string };
  /**
   * Walk-in orders for restaurants, bars and events (migration 0047): QR
   * receipts, pickup screens, table numbers. Only set when QUOTE_WALK_IN is true.
   */
  quoteWalkIn?: { publicUrl: string };
  /** Product photos and stock levels for the quote bot (migration 0037). Off unless QUOTE_CATALOGUE is true. */
  quoteCatalogue: boolean;
  /** Each quote business's own referral code (migration 0041). Off unless QUOTE_REFERRALS is true. */
  quoteReferrals: boolean;
  /**
   * Paystack pay links on quote invoices, for businesses with a Paystack
   * subaccount (migration 0045). Off unless QUOTE_PAY_LINKS is true; needs Paystack.
   */
  quotePayLinks: boolean;
  /**
   * Quote businesses can be branches of another (migration 0038), up to the
   * main business's plan limit. Off unless QUOTE_BRANCHES is true.
   */
  quoteBranches: boolean;
  /**
   * Sign-up by WhatsApp chat on the yarnOga quotes number (migration 0039).
   * Only set when QUOTE_SIGNUP_PHONE_NUMBER_ID is, and needs QUOTE_MULTI_BUSINESS.
   */
  quoteChatSignup?: {
    phoneNumberId: string;
    /** Gets a WhatsApp message for each new sign-up. */
    alertWaId?: string;
  };
  /**
   * Broadcasts to customers who opted in (a paid add-on for quote bot
   * businesses). Only set when BROADCASTS_ENABLED is true.
   */
  broadcasts?: {
    /** Approved Marketing template: {{1}} = business name, {{2}} = the message. */
    template: { name: string; language: string };
    /** The same with a picture header. Without it, broadcasts are text only. */
    imageTemplateName?: string;
    perMinute: number;
    /** Rough Meta charge per marketing message in kobo, for the owner's preview. */
    costPerMessageKobo?: number;
  };
  /**
   * Quote follow-ups: one reminder for a quote the customer never answered.
   * Only set when QUOTE_FOLLOW_UPS is true (needs migration 0027).
   */
  quoteFollowUps?: {
    /** Hours after a quote before the reminder goes (businesses can set their own). */
    hours: number;
    /** Approved WhatsApp template for customers outside the 24-hour window. */
    template?: { name: string; language: string };
  };
  /**
   * Enforce what each quote plan includes (AI credits, voice notes, invoices;
   * quote_plan_features table). Only matters for businesses on a plan.
   * Off unless QUOTE_PLAN_FEATURES is true.
   */
  quotePlanFeatures: boolean;
  /**
   * The owner setup screen at /quote-setup (businesses and price lists for
   * the quote bot). Only set when QUOTE_SETUP_PASSWORD is.
   */
  quoteSetup?: {
    password: string;
    /** "Let AI draft it" on the price list page; off unless QUOTE_SETUP_AI_DRAFT is on. */
    aiDraft?: { anthropicApiKey: string; model: string; perDay: number };
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
   * The public sign-up page at /signup where a business connects its WhatsApp
   * number through Meta's pop-up (Embedded Signup). Only set when
   * META_SIGNUP_CONFIG_ID is.
   */
  signup?: {
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
  /**
   * CFA franc payments (Mobile Money and cards) through Flutterwave. Only set
   * when FLUTTERWAVE_SECRET_KEY is.
   */
  /**
   * Text-to-speech for voice replies: Azure (AZURE_SPEECH_KEY and
   * AZURE_SPEECH_REGION) when set, otherwise Google (GOOGLE_TTS_API_KEY).
   */
  tts?: { provider: "azure" | "google"; apiKey: string; region?: string; voices: { fr?: string; en?: string } };
  /** Payment reminders for confirmed, unpaid orders (QUOTE_PAY_REMINDERS, migration 0054). */
  quotePayReminders: boolean;
  /** Ask customers to rate finished orders (QUOTE_RATINGS, migration 0054). */
  quoteRatings: boolean;
  /** Couriers through Shipbubble (SHIPBUBBLE_API_KEY), for addresses outside a business's own zones. */
  shipbubble?: { apiKey: string; contactEmail: string; categoryId?: number; itemKg: number };
  flutterwave?: {
    secretKey: string;
    /** The secret hash set in Flutterwave > Settings > Webhooks; it proves a webhook came from Flutterwave. */
    secretHash: string;
    publicUrl: string;
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
    alerts: alertSettings(env),
    ownerApp: /^(true|yes|on|1)$/i.test(env.OWNER_APP ?? "")
      ? {
          publicUrl: publicUrl(env.OWNER_APP_URL || required(env, "PUBLIC_URL")),
          supportEmail: env.SUPPORT_EMAIL?.trim() || "support@yarnoga.com",
          supportWaId: env.SUPPORT_WA_ID?.replace(/\D/g, "") || undefined,
        }
      : undefined,
    compliance: env.COMPLIANCE_PASSWORD
      ? {
          password: longPassword(env, "COMPLIANCE_PASSWORD"),
          dojah:
            env.DOJAH_APP_ID?.trim() && env.DOJAH_SECRET_KEY?.trim()
              ? { appId: env.DOJAH_APP_ID.trim(), secretKey: env.DOJAH_SECRET_KEY.trim(), sandbox: /^(true|yes|on|1)$/i.test(env.DOJAH_SANDBOX ?? "") }
              : undefined,
        }
      : undefined,
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
            plan: env.QUOTE_PLAN?.trim().toLowerCase() || undefined,
            paystackSubaccount: subaccount(env.QUOTE_PAYSTACK_SUBACCOUNT),
            flutterwaveSubaccount: flutterwaveSubaccount(env.QUOTE_FLUTTERWAVE_SUBACCOUNT),
            language: oneOf(env.QUOTE_LANGUAGE?.trim().toLowerCase() || "en", isLang, "QUOTE_LANGUAGE", "en or fr"),
            currency: oneOf(env.QUOTE_CURRENCY?.trim().toUpperCase() || "NGN", isCurrency, "QUOTE_CURRENCY", "NGN, XOF or XAF"),
            voiceReplies: /^(true|yes|on|1)$/i.test(env.QUOTE_VOICE_REPLIES ?? ""),
            courierDelivery: /^(true|yes|on|1)$/i.test(env.QUOTE_COURIER_DELIVERY ?? ""),
          }
        : undefined,
    quoteBusinesses: /^(true|yes|on|1)$/i.test(env.QUOTE_MULTI_BUSINESS ?? "")
      ? { anthropicApiKey: required(env, "ANTHROPIC_API_KEY"), model: env.ANTHROPIC_MODEL || "claude-haiku-5-5" }
      : undefined,
    delivery: /^(true|yes|on|1)$/i.test(env.QUOTE_DELIVERY ?? "")
      ? {
          publicUrl: publicUrl(required(env, "PUBLIC_URL")),
          template: env.QUOTE_DELIVERY_TEMPLATE_NAME
            ? { name: env.QUOTE_DELIVERY_TEMPLATE_NAME, language: env.QUOTE_DELIVERY_TEMPLATE_LANGUAGE || "en" }
            : undefined,
        }
      : undefined,
    quoteCatalogue: /^(true|yes|on|1)$/i.test(env.QUOTE_CATALOGUE ?? ""),
    quoteBranches: /^(true|yes|on|1)$/i.test(env.QUOTE_BRANCHES ?? ""),
    quoteReferrals: /^(true|yes|on|1)$/i.test(env.QUOTE_REFERRALS ?? ""),
    quotePayLinks: /^(true|yes|on|1)$/i.test(env.QUOTE_PAY_LINKS ?? ""),
    quoteChatSignup: env.QUOTE_SIGNUP_PHONE_NUMBER_ID?.trim()
      ? {
          phoneNumberId: env.QUOTE_SIGNUP_PHONE_NUMBER_ID.trim(),
          alertWaId: env.QUOTE_SIGNUP_ALERT_WA_ID?.replace(/\D/g, "") || undefined,
        }
      : undefined,
    quoteOrderBoard: /^(true|yes|on|1)$/i.test(env.QUOTE_ORDER_BOARD ?? "")
      ? { publicUrl: publicUrl(required(env, "PUBLIC_URL")) }
      : undefined,
    quoteWalkIn: /^(true|yes|on|1)$/i.test(env.QUOTE_WALK_IN ?? "")
      ? { publicUrl: publicUrl(required(env, "PUBLIC_URL")) }
      : undefined,
    broadcasts: /^(true|yes|on|1)$/i.test(env.BROADCASTS_ENABLED ?? "")
      ? {
          template: {
            name: required(env, "BROADCAST_TEMPLATE_NAME"),
            language: env.BROADCAST_TEMPLATE_LANGUAGE || "en",
          },
          imageTemplateName: env.BROADCAST_IMAGE_TEMPLATE_NAME || undefined,
          perMinute: wholeNumber(env, "BROADCASTS_PER_MINUTE", 30),
          costPerMessageKobo: env.BROADCAST_COST_KOBO ? wholeNumber(env, "BROADCAST_COST_KOBO", 1) : undefined,
        }
      : undefined,
    quoteFollowUps: /^(true|yes|on|1)$/i.test(env.QUOTE_FOLLOW_UPS ?? "")
      ? {
          hours: followUpHours(env.QUOTE_FOLLOW_UP_HOURS),
          template: env.QUOTE_FOLLOW_UP_TEMPLATE_NAME
            ? { name: env.QUOTE_FOLLOW_UP_TEMPLATE_NAME, language: env.QUOTE_FOLLOW_UP_TEMPLATE_LANGUAGE || "en" }
            : undefined,
        }
      : undefined,
    quotePlanFeatures: /^(true|yes|on|1)$/i.test(env.QUOTE_PLAN_FEATURES ?? ""),
    quoteSetup: env.QUOTE_SETUP_PASSWORD
      ? {
          password: longPassword(env, "QUOTE_SETUP_PASSWORD"),
          aiDraft: /^(true|yes|on|1)$/i.test(env.QUOTE_SETUP_AI_DRAFT ?? "")
            ? {
                anthropicApiKey: required(env, "ANTHROPIC_API_KEY"),
                model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
                perDay: wholeNumber(env, "QUOTE_SETUP_AI_DRAFTS_PER_DAY", 30),
              }
            : undefined,
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
    signup: env.META_SIGNUP_CONFIG_ID?.trim()
      ? {
          appId: required(env, "META_APP_ID"),
          configId: env.META_SIGNUP_CONFIG_ID.trim(),
        }
      : undefined,
    paystack: paystackSettings(env),
    flutterwave: flutterwaveSettings(env),
    shipbubble: shipbubbleSettings(env),
    quotePayReminders: /^(true|yes|on|1)$/i.test(env.QUOTE_PAY_REMINDERS ?? ""),
    quoteRatings: /^(true|yes|on|1)$/i.test(env.QUOTE_RATINGS ?? ""),
    tts: ttsSettings(env),
  };
}

function publicUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/\s]+$/.test(url)) {
    throw new Error(`PUBLIC_URL must be the server's https address with nothing after it, e.g. https://example.up.railway.app (got "${value}")`);
  }
  return url;
}

function followUpHours(value: string | undefined): number {
  const hours = Number(value || 24);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new Error(`QUOTE_FOLLOW_UP_HOURS must be a whole number of hours from 1 to 168 (got "${value}")`);
  }
  return hours;
}

function longPassword(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name] ?? "";
  if (value.length < 12) throw new Error(`${name} must be at least 12 characters long`);
  return value;
}

function subaccount(value: string | undefined): string | undefined {
  const code = value?.trim();
  if (!code) return undefined;
  if (!/^ACCT_[a-z0-9]+$/i.test(code)) throw new Error("QUOTE_PAYSTACK_SUBACCOUNT must be a Paystack subaccount code, e.g. ACCT_8f4s1eq7ml6rlzj");
  return code;
}

function flutterwaveSubaccount(value: string | undefined): string | undefined {
  const code = value?.trim();
  if (!code) return undefined;
  if (!/^RS_[A-Za-z0-9]+$/.test(code)) throw new Error("QUOTE_FLUTTERWAVE_SUBACCOUNT must be a Flutterwave subaccount ID, e.g. RS_A1B2C3D4E5F6");
  return code;
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

function shipbubbleSettings(env: NodeJS.ProcessEnv): Config["shipbubble"] {
  const apiKey = env.SHIPBUBBLE_API_KEY?.trim();
  if (!apiKey) return undefined;
  if (!/^sb_(sandbox|prod)_/.test(apiKey)) {
    throw new Error("SHIPBUBBLE_API_KEY must be a Shipbubble API key (starts with sb_sandbox_ or sb_prod_)");
  }
  const contactEmail = env.SHIPBUBBLE_CONTACT_EMAIL?.trim() || env.PAYSTACK_CUSTOMER_EMAIL?.trim();
  if (!contactEmail) throw new Error("Missing required environment variable: SHIPBUBBLE_CONTACT_EMAIL (or PAYSTACK_CUSTOMER_EMAIL) (see .env.example)");
  const category = env.SHIPBUBBLE_CATEGORY_ID?.trim();
  if (category && !/^\d+$/.test(category)) throw new Error("SHIPBUBBLE_CATEGORY_ID must be a number from Shipbubble's package categories");
  const kg = Number(env.SHIPBUBBLE_ITEM_KG?.trim() || "0.5");
  if (!(kg > 0 && kg <= 100)) throw new Error("SHIPBUBBLE_ITEM_KG must be a weight in kg, e.g. 0.5");
  return { apiKey, contactEmail, categoryId: category ? Number(category) : undefined, itemKg: kg };
}

function ttsSettings(env: NodeJS.ProcessEnv): Config["tts"] {
  const azureKey = env.AZURE_SPEECH_KEY?.trim();
  if (azureKey) {
    const region = env.AZURE_SPEECH_REGION?.trim().toLowerCase().replace(/\s+/g, "");
    if (!region || !/^[a-z0-9]+$/.test(region)) {
      throw new Error("AZURE_SPEECH_REGION must be set to your Speech resource's region, e.g. westeurope (Azure portal > your Speech resource > Keys and Endpoint)");
    }
    return {
      provider: "azure",
      apiKey: azureKey,
      region,
      voices: { fr: env.AZURE_TTS_VOICE_FR?.trim() || undefined, en: env.AZURE_TTS_VOICE_EN?.trim() || undefined },
    };
  }
  const googleKey = env.GOOGLE_TTS_API_KEY?.trim();
  if (!googleKey) return undefined;
  return {
    provider: "google",
    apiKey: googleKey,
    voices: { fr: env.GOOGLE_TTS_VOICE_FR?.trim() || undefined, en: env.GOOGLE_TTS_VOICE_EN?.trim() || undefined },
  };
}

function flutterwaveSettings(env: NodeJS.ProcessEnv): Config["flutterwave"] {
  const secretKey = env.FLUTTERWAVE_SECRET_KEY?.trim();
  if (!secretKey) return undefined;
  if (!/^FLWSECK(_TEST)?-/.test(secretKey)) {
    throw new Error("FLUTTERWAVE_SECRET_KEY must be the secret key (starts with FLWSECK- or FLWSECK_TEST-), not the public or encryption key");
  }
  const secretHash = env.FLUTTERWAVE_SECRET_HASH?.trim();
  if (!secretHash || secretHash.length < 16) {
    throw new Error("FLUTTERWAVE_SECRET_HASH must be set, at least 16 characters, and match the secret hash in Flutterwave > Settings > Webhooks");
  }
  const publicUrl = required(env, "PUBLIC_URL").replace(/\/+$/, "");
  if (!publicUrl.startsWith("https://")) throw new Error(`PUBLIC_URL must start with https:// (got "${publicUrl}")`);
  const customerEmail = env.FLUTTERWAVE_CUSTOMER_EMAIL?.trim() || env.PAYSTACK_CUSTOMER_EMAIL?.trim();
  if (!customerEmail) throw new Error("Missing required environment variable: FLUTTERWAVE_CUSTOMER_EMAIL (or PAYSTACK_CUSTOMER_EMAIL) (see .env.example)");
  return { secretKey, secretHash, publicUrl, customerEmail };
}

function alertSettings(env: NodeJS.ProcessEnv): Config["alerts"] {
  const waId = env.ALERT_WA_ID?.replace(/\D/g, "") || undefined;
  const to = env.ALERT_EMAIL?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();
  if (to && !apiKey) throw new Error("ALERT_EMAIL needs RESEND_API_KEY too (emails are sent through resend.com)");
  const dsn = env.SENTRY_DSN?.trim();
  if (dsn && !/^https:\/\/[^@\s]+@[^/\s]+\/\d+$/.test(dsn)) {
    throw new Error("SENTRY_DSN must be the DSN from Sentry > Project settings > Client Keys, e.g. https://abc123@o456.ingest.sentry.io/789");
  }
  return {
    waId,
    template: env.ALERT_TEMPLATE_NAME
      ? { name: env.ALERT_TEMPLATE_NAME, language: env.ALERT_TEMPLATE_LANGUAGE || "en" }
      : undefined,
    email: to && apiKey ? { apiKey, to, from: env.ALERT_EMAIL_FROM?.trim() || "yarnOga alerts <alerts@yarnoga.com>" } : undefined,
    sentry: dsn ? { dsn, environment: env.SENTRY_ENVIRONMENT?.trim() || "production" } : undefined,
  };
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

function oneOf<T extends string>(value: string, ok: (v: unknown) => v is T, name: string, allowed: string): T {
  if (!ok(value)) throw new Error(`${name} must be ${allowed} (got "${value}")`);
  return value;
}

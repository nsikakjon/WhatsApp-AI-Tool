import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  WHATSAPP_VERIFY_TOKEN: "v",
  WHATSAPP_APP_SECRET: "s",
  WHATSAPP_ACCESS_TOKEN: "t",
  WHATSAPP_PHONE_NUMBER_ID: "p",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "k",
};

describe("loadConfig", () => {
  it("defaults to the echo product and needs no AI key", () => {
    const config = loadConfig(base);
    expect(config.activeProduct).toBe("echo");
    expect(config.quote).toBeUndefined();
  });

  it("requires an Anthropic key for the quote bot", () => {
    expect(() => loadConfig({ ...base, ACTIVE_PRODUCT: "quote" })).toThrow("ANTHROPIC_API_KEY");
  });

  it("reads quote bot settings with sensible defaults", () => {
    const config = loadConfig({ ...base, ACTIVE_PRODUCT: "quote", ANTHROPIC_API_KEY: "a", QUOTE_OWNER_WA_ID: "+234 801 234 5678" });
    expect(config.quote).toEqual({
      anthropicApiKey: "a",
      model: "claude-haiku-5-5",
      businessName: "KahnPrints",
      orderPrefix: "KP",
      ownerWaId: "2348012345678",
      language: "en",
      currency: "NGN",
      voiceReplies: false,
    });
    expect(loadConfig({ ...base, ACTIVE_PRODUCT: "quote", ANTHROPIC_API_KEY: "a", QUOTE_LANGUAGE: "FR", QUOTE_CURRENCY: "xof" }).quote).toMatchObject({ language: "fr", currency: "XOF" });
    expect(() => loadConfig({ ...base, ACTIVE_PRODUCT: "quote", ANTHROPIC_API_KEY: "a", QUOTE_CURRENCY: "USD" })).toThrow("QUOTE_CURRENCY");
  });

  it("keeps broadcasts off unless BROADCASTS_ENABLED is true, and then needs a template", () => {
    expect(loadConfig(base).broadcasts).toBeUndefined();
    expect(() => loadConfig({ ...base, BROADCASTS_ENABLED: "true" })).toThrow("BROADCAST_TEMPLATE_NAME");
    expect(loadConfig({ ...base, BROADCASTS_ENABLED: "true", BROADCAST_TEMPLATE_NAME: "business_offer" }).broadcasts).toEqual({
      template: { name: "business_offer", language: "en" },
      imageTemplateName: undefined,
      perMinute: 30,
      costPerMessageKobo: undefined,
    });
    expect(
      loadConfig({ ...base, BROADCASTS_ENABLED: "true", BROADCAST_TEMPLATE_NAME: "b", BROADCAST_COST_KOBO: "7000" }).broadcasts
        ?.costPerMessageKobo,
    ).toBe(7000);
  });

  it("keeps the order board off unless QUOTE_ORDER_BOARD is true, and then needs the public address", () => {
    expect(loadConfig(base).quoteOrderBoard).toBeUndefined();
    expect(() => loadConfig({ ...base, QUOTE_ORDER_BOARD: "true" })).toThrow("PUBLIC_URL");
    expect(loadConfig({ ...base, QUOTE_ORDER_BOARD: "true", PUBLIC_URL: "https://bot.example.com/" }).quoteOrderBoard).toEqual({
      publicUrl: "https://bot.example.com",
    });
  });

  it("keeps walk-in orders off unless QUOTE_WALK_IN is true, and then needs the public address", () => {
    expect(loadConfig(base).quoteWalkIn).toBeUndefined();
    expect(() => loadConfig({ ...base, QUOTE_WALK_IN: "true" })).toThrow("PUBLIC_URL");
    expect(loadConfig({ ...base, QUOTE_WALK_IN: "true", PUBLIC_URL: "https://bot.example.com" }).quoteWalkIn).toEqual({
      publicUrl: "https://bot.example.com",
    });
  });

  it("keeps delivery off unless QUOTE_DELIVERY is true, and then needs the public address", () => {
    expect(loadConfig(base).delivery).toBeUndefined();
    expect(() => loadConfig({ ...base, QUOTE_DELIVERY: "true" })).toThrow("PUBLIC_URL");
    expect(() => loadConfig({ ...base, QUOTE_DELIVERY: "true", PUBLIC_URL: "http://bot.example.com/track" })).toThrow("PUBLIC_URL");
    expect(
      loadConfig({ ...base, QUOTE_DELIVERY: "true", PUBLIC_URL: "https://bot.example.com/", QUOTE_DELIVERY_TEMPLATE_NAME: "order_update" })
        .delivery,
    ).toEqual({ publicUrl: "https://bot.example.com", template: { name: "order_update", language: "en" } });
  });

  it("keeps more quote businesses off unless QUOTE_MULTI_BUSINESS is true", () => {
    expect(loadConfig(base).quoteBusinesses).toBeUndefined();
    expect(() => loadConfig({ ...base, QUOTE_MULTI_BUSINESS: "true" })).toThrow("ANTHROPIC_API_KEY");
    expect(loadConfig({ ...base, QUOTE_MULTI_BUSINESS: "true", ANTHROPIC_API_KEY: "a" }).quoteBusinesses).toEqual({
      anthropicApiKey: "a",
      model: "claude-haiku-5-5",
    });
  });

  it("keeps quote reminders off unless QUOTE_FOLLOW_UPS is true", () => {
    expect(loadConfig(base).quoteFollowUps).toBeUndefined();
    expect(loadConfig({ ...base, QUOTE_FOLLOW_UPS: "true" }).quoteFollowUps).toEqual({ hours: 24, template: undefined });
    expect(
      loadConfig({ ...base, QUOTE_FOLLOW_UPS: "on", QUOTE_FOLLOW_UP_HOURS: "20", QUOTE_FOLLOW_UP_TEMPLATE_NAME: "quote_reminder" })
        .quoteFollowUps,
    ).toEqual({ hours: 20, template: { name: "quote_reminder", language: "en" } });
    expect(() => loadConfig({ ...base, QUOTE_FOLLOW_UPS: "true", QUOTE_FOLLOW_UP_HOURS: "0" })).toThrow("QUOTE_FOLLOW_UP_HOURS");
  });

  it("switches the quote setup screen on only with a long enough password", () => {
    expect(loadConfig(base).quoteSetup).toBeUndefined();
    expect(() => loadConfig({ ...base, QUOTE_SETUP_PASSWORD: "short" })).toThrow("at least 12");
    expect(loadConfig({ ...base, QUOTE_SETUP_PASSWORD: "long enough pass" }).quoteSetup).toEqual({ password: "long enough pass" });
  });

  it("adds the AI price list draft only when switched on, and needs an Anthropic key", () => {
    const setup = { ...base, QUOTE_SETUP_PASSWORD: "long enough pass" };
    expect(loadConfig(setup).quoteSetup?.aiDraft).toBeUndefined();
    expect(() => loadConfig({ ...setup, QUOTE_SETUP_AI_DRAFT: "true" })).toThrow("ANTHROPIC_API_KEY");
    expect(loadConfig({ ...setup, QUOTE_SETUP_AI_DRAFT: "true", ANTHROPIC_API_KEY: "k" }).quoteSetup?.aiDraft).toEqual({
      anthropicApiKey: "k",
      model: "claude-haiku-5-5",
      perDay: 30,
    });
  });

  it("reads invoice details, with | starting a new line", () => {
    const config = loadConfig({
      ...base,
      ACTIVE_PRODUCT: "quote",
      ANTHROPIC_API_KEY: "a",
      QUOTE_BUSINESS_DETAILS: "Ikeja, Lagos",
      QUOTE_PAYMENT_DETAILS: "Bank 0000000000 | Example Ltd",
    });
    expect(config.quote?.businessDetails).toBe("Ikeja, Lagos");
    expect(config.quote?.paymentDetails).toBe("Bank 0000000000\nExample Ltd");
  });

  it("pauses the bot for 60 minutes after an owner reply unless told otherwise", () => {
    expect(loadConfig(base).ownerReplyPauseMinutes).toBe(60);
    expect(loadConfig({ ...base, OWNER_REPLY_PAUSE_MINUTES: "15" }).ownerReplyPauseMinutes).toBe(15);
    expect(loadConfig({ ...base, OWNER_REPLY_PAUSE_MINUTES: "0" }).ownerReplyPauseMinutes).toBe(0);
    expect(() => loadConfig({ ...base, OWNER_REPLY_PAUSE_MINUTES: "half an hour" })).toThrow("OWNER_REPLY_PAUSE_MINUTES");
  });

  it("turns on the staff inbox only with a long enough password", () => {
    expect(loadConfig(base).inbox).toBeUndefined();
    expect(loadConfig({ ...base, INBOX_PASSWORD: "a-long-password" }).inbox).toEqual({ password: "a-long-password" });
    expect(() => loadConfig({ ...base, INBOX_PASSWORD: "short" })).toThrow("at least 12");
  });

  it("switches on the sign-up page with its configuration ID, and then needs the App ID", () => {
    expect(loadConfig(base).signup).toBeUndefined();
    expect(() => loadConfig({ ...base, META_SIGNUP_CONFIG_ID: "2" })).toThrow("META_APP_ID");
    expect(loadConfig({ ...base, META_APP_ID: "1", META_SIGNUP_CONFIG_ID: "2" }).signup).toEqual({ appId: "1", configId: "2" });
  });

  it("reads the quote plan, off when unset", () => {
    const quote = { ...base, ACTIVE_PRODUCT: "quote", ANTHROPIC_API_KEY: "a" };
    expect(loadConfig(quote).quote?.plan).toBeUndefined();
    expect(loadConfig({ ...quote, QUOTE_PLAN: " Free " }).quote?.plan).toBe("free");
  });

  it("leaves plan features off unless switched on", () => {
    expect(loadConfig(base).quotePlanFeatures).toBe(false);
    expect(loadConfig({ ...base, QUOTE_PLAN_FEATURES: "true" }).quotePlanFeatures).toBe(true);
  });

  it("switches Paystack on only with a secret key, and then needs the rest", () => {
    expect(loadConfig(base).paystack).toBeUndefined();
    expect(() => loadConfig({ ...base, PAYSTACK_SECRET_KEY: "pk_test_abc" })).toThrow("not the public key");
    expect(() => loadConfig({ ...base, PAYSTACK_SECRET_KEY: "sk_test_abc" })).toThrow("PUBLIC_URL");
    expect(() =>
      loadConfig({ ...base, PAYSTACK_SECRET_KEY: "sk_test_abc", PUBLIC_URL: "https://bot.example.com" }),
    ).toThrow("PAYSTACK_CUSTOMER_EMAIL");
    expect(
      loadConfig({
        ...base,
        PAYSTACK_SECRET_KEY: "sk_test_abc",
        PUBLIC_URL: "https://bot.example.com/",
        PAYSTACK_CUSTOMER_EMAIL: "payments@example.com",
      }).paystack,
    ).toEqual({ secretKey: "sk_test_abc", publicUrl: "https://bot.example.com", customerEmail: "payments@example.com" });
  });

  it("rejects an unknown product", () => {
    expect(() => loadConfig({ ...base, ACTIVE_PRODUCT: "pizza" })).toThrow("ACTIVE_PRODUCT");
  });

  it("turns on voice notes only when a Groq key is set", () => {
    expect(loadConfig(base).groq).toBeUndefined();
    expect(loadConfig({ ...base, GROQ_API_KEY: "g" }).groq).toEqual({ apiKey: "g", model: "whisper-large-v3" });
  });

  it("switches on the site reporter only when its number is set", () => {
    expect(loadConfig(base).site).toBeUndefined();
    expect(() => loadConfig({ ...base, SITE_PHONE_NUMBER_ID: "site" })).toThrow("ANTHROPIC_API_KEY");
    expect(loadConfig({ ...base, SITE_PHONE_NUMBER_ID: "site", ANTHROPIC_API_KEY: "a" }).site).toEqual({
      phoneNumberId: "site",
      anthropicApiKey: "a",
      model: "claude-haiku-5-5",
      reportHour: 18,
    });
  });

  it("switches on the lead qualifier only when its number is set, and needs agents", () => {
    expect(loadConfig(base).leads).toBeUndefined();
    const on = { ...base, LEADS_PHONE_NUMBER_ID: "leads", ANTHROPIC_API_KEY: "a" };
    expect(() => loadConfig(on)).toThrow("LEADS_AGENT_WA_IDS");
    expect(() => loadConfig({ ...on, LEADS_AGENT_WA_IDS: " , " })).toThrow("at least one");
    expect(loadConfig({ ...on, LEADS_AGENT_WA_IDS: "+234 801 234 5678, 2348098765432" }).leads).toEqual({
      phoneNumberId: "leads",
      anthropicApiKey: "a",
      model: "claude-haiku-5-5",
      businessName: "our real estate team",
      agentWaIds: ["2348012345678", "2348098765432"],
    });
  });

  it("rejects a report hour that isn't 0 to 23", () => {
    expect(() => loadConfig({ ...base, SITE_REPORT_HOUR: "25" })).toThrow("SITE_REPORT_HOUR");
  });

  it("switches on the flyer bot only when its number is set", () => {
    expect(loadConfig(base).flyer).toBeUndefined();
    expect(() => loadConfig({ ...base, FLYER_PHONE_NUMBER_ID: "f" })).toThrow("FLYER_OWNER_WA_IDS");
    expect(loadConfig({ ...base, FLYER_PHONE_NUMBER_ID: "f", FLYER_OWNER_WA_IDS: "+234 801 234 5678, 2348000000002" }).flyer).toEqual({
      phoneNumberId: "f",
      ownerWaIds: ["2348012345678", "2348000000002"],
      openSignup: true,
      brandName: "Flyer Bot",
      credit: "",
      sendHour: 8,
      anthropicApiKey: undefined,
      model: "claude-haiku-5-5",
      template: undefined,
    });
    expect(
      loadConfig({ ...base, FLYER_PHONE_NUMBER_ID: "f", FLYER_OWNER_WA_IDS: "1", FLYER_TEMPLATE_NAME: "birthday_flyer" }).flyer?.template,
    ).toEqual({ name: "birthday_flyer", language: "en" });
    expect(loadConfig({ ...base, FLYER_PHONE_NUMBER_ID: "f", FLYER_OWNER_WA_IDS: "1", FLYER_OPEN_SIGNUP: "false" }).flyer?.openSignup).toBe(false);
    expect(() => loadConfig({ ...base, FLYER_SEND_HOUR: "24" })).toThrow("FLYER_SEND_HOUR");
  });

  it("reads who gets alerts, and needs a Resend key for email", () => {
    expect(loadConfig(base).alerts).toEqual({ waId: undefined, template: undefined, email: undefined, sentry: undefined });
    const alerts = loadConfig({
      ...base,
      ALERT_WA_ID: "+234 801 234 5678",
      ALERT_EMAIL: "jay@example.com",
      RESEND_API_KEY: "re_x",
      SENTRY_DSN: "https://abc@o1.ingest.sentry.io/42",
    }).alerts;
    expect(alerts.waId).toBe("2348012345678");
    expect(alerts.email).toEqual({ apiKey: "re_x", to: "jay@example.com", from: "yarnOga alerts <alerts@yarnoga.com>" });
    expect(alerts.sentry).toEqual({ dsn: "https://abc@o1.ingest.sentry.io/42", environment: "production" });
    expect(() => loadConfig({ ...base, ALERT_EMAIL: "jay@example.com" })).toThrow("RESEND_API_KEY");
    expect(() => loadConfig({ ...base, SENTRY_DSN: "nope" })).toThrow("SENTRY_DSN");
  });

  it("switches the compliance page on with a long password, and Dojah when both keys are set", () => {
    expect(loadConfig(base).compliance).toBeUndefined();
    expect(() => loadConfig({ ...base, COMPLIANCE_PASSWORD: "short" })).toThrow("COMPLIANCE_PASSWORD");
    expect(loadConfig({ ...base, COMPLIANCE_PASSWORD: "a long enough pass" }).compliance).toEqual({ password: "a long enough pass", dojah: undefined });
    expect(
      loadConfig({ ...base, COMPLIANCE_PASSWORD: "a long enough pass", DOJAH_APP_ID: "app", DOJAH_SECRET_KEY: "sk", DOJAH_SANDBOX: "true" }).compliance?.dojah,
    ).toEqual({ appId: "app", secretKey: "sk", sandbox: true });
  });

  it("switches the owner app on with a public address", () => {
    expect(loadConfig(base).ownerApp).toBeUndefined();
    expect(loadConfig({ ...base, OWNER_APP: "true", PUBLIC_URL: "https://bot.example.com" }).ownerApp).toEqual({
      publicUrl: "https://bot.example.com",
      supportEmail: "support@yarnoga.com",
      supportWaId: undefined,
    });
    expect(
      loadConfig({ ...base, OWNER_APP: "true", PUBLIC_URL: "https://bot.example.com", OWNER_APP_URL: "https://app.yarnoga.com", SUPPORT_WA_ID: "+234 800 000 0000" }).ownerApp,
    ).toMatchObject({ publicUrl: "https://app.yarnoga.com", supportWaId: "2348000000000" });
  });
});

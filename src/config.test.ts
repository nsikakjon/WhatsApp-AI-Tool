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
});

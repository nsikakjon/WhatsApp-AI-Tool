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

  it("rejects an unknown product", () => {
    expect(() => loadConfig({ ...base, ACTIVE_PRODUCT: "pizza" })).toThrow("ACTIVE_PRODUCT");
  });

  it("turns on voice notes only when a Groq key is set", () => {
    expect(loadConfig(base).groq).toBeUndefined();
    expect(loadConfig({ ...base, GROQ_API_KEY: "g" }).groq).toEqual({ apiKey: "g", model: "whisper-large-v3" });
  });
});

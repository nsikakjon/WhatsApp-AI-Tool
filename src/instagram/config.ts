// Settings for the Instagram comment auto-reply. It is OFF unless
// INSTAGRAM_AUTOREPLY is "on". If it is switched on but a setting is missing,
// it stays off and the server logs what is missing: the WhatsApp bots keep
// running either way, so a typo here can never take them down.

export interface InstagramConfig {
  /** The Instagram professional account's id (from the Meta app dashboard). */
  accountId: string;
  /** Instagram access token with instagram_business_manage_comments and instagram_business_manage_messages. */
  accessToken: string;
  /** The Instagram app secret, used to check that webhooks really came from Meta. */
  appSecret: string;
  /** The password typed into Meta's webhook settings. */
  verifyToken: string;
  /** The leads WhatsApp number people are sent to, digits only, e.g. 2348012345678. */
  whatsappNumber: string;
  /** The name used in replies, e.g. "Acme Homes". */
  businessName: string;
  graphApiVersion: string;
}

export type InstagramSetup =
  | { status: "off" }
  | { status: "missing"; missing: string[] }
  | { status: "on"; config: InstagramConfig };

export function loadInstagramConfig(env: NodeJS.ProcessEnv = process.env): InstagramSetup {
  if (!/^(on|true|yes|1)$/i.test(env.INSTAGRAM_AUTOREPLY ?? "")) return { status: "off" };

  const whatsappNumber = (env.INSTAGRAM_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  const verifyToken = env.INSTAGRAM_VERIFY_TOKEN || env.WHATSAPP_VERIFY_TOKEN || "";
  const values: Record<string, string> = {
    INSTAGRAM_ACCOUNT_ID: env.INSTAGRAM_ACCOUNT_ID ?? "",
    INSTAGRAM_ACCESS_TOKEN: env.INSTAGRAM_ACCESS_TOKEN ?? "",
    INSTAGRAM_APP_SECRET: env.INSTAGRAM_APP_SECRET ?? "",
    INSTAGRAM_WHATSAPP_NUMBER: whatsappNumber,
    INSTAGRAM_VERIFY_TOKEN: verifyToken,
  };
  const missing = Object.keys(values).filter((name) => !values[name]);
  if (missing.length) return { status: "missing", missing };

  return {
    status: "on",
    config: {
      accountId: values.INSTAGRAM_ACCOUNT_ID,
      accessToken: values.INSTAGRAM_ACCESS_TOKEN,
      appSecret: values.INSTAGRAM_APP_SECRET,
      verifyToken,
      whatsappNumber,
      businessName: env.INSTAGRAM_BUSINESS_NAME || env.LEADS_BUSINESS_NAME || "our team",
      graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION || "v23.0",
    },
  };
}

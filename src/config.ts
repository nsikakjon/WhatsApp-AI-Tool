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
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
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
  };
}

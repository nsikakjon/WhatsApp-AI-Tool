// Settings for the owner test screen. It is switched off unless
// BOT_TEST_PASSWORD is set, and a short password keeps it off too.

export const MIN_PASSWORD = 12;

export type BotTestSetup =
  | { status: "off" }
  | { status: "weak" }
  | { status: "on"; password: string; dailyLimit: number };

export function loadBotTestConfig(env: NodeJS.ProcessEnv = process.env): BotTestSetup {
  const password = env.BOT_TEST_PASSWORD ?? "";
  if (!password) return { status: "off" };
  if (password.length < MIN_PASSWORD) return { status: "weak" };
  const limit = Number(env.BOT_TEST_DAILY_LIMIT || 300);
  return { status: "on", password, dailyLimit: Number.isInteger(limit) && limit > 0 ? limit : 300 };
}

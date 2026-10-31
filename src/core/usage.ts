import type { SupabaseClient } from "@supabase/supabase-js";

// What each WhatsApp number costs us to run: the AI tokens Anthropic bills for
// each reply and the seconds Groq bills for each voice note. Each call's cost
// is priced here, in millionths of a dollar ("micro-dollars"), and added to the
// number's total for the Lagos month (migration 0065). Meta's message fees are
// worked out on the dashboard from the sent-message counts instead.
//
// Prices are Anthropic's and Groq's published list prices in US dollars,
// checked 31 October 2026. When a provider changes its price, change it here.

/** Dollars per million tokens, in micro-dollars: 100_000 = $0.10 per million. */
const AI_PRICES: { match: string; input: number; output: number }[] = [
  { match: "haiku", input: 100_000, output: 500_000 },
  { match: "sonnet", input: 2_000_000, output: 10_000_000 },
  { match: "opus", input: 4_000_000, output: 20_000_000 },
];

/** Dollars per hour of audio, in micro-dollars. Groq bills at least 10 seconds a note. */
const VOICE_PRICES: Record<string, number> = {
  "whisper-large-v3": 111_000,
  "whisper-large-v3-turbo": 40_000,
};
const VOICE_MIN_SECONDS = 10;

/** The token counts Anthropic returns on every response. */
export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** The cost of one AI call in micro-dollars. Cache writes bill at 1.25x input, cache reads at 0.1x. */
export function aiCostMicroUsd(model: string, usage: AiUsage): number {
  const price = AI_PRICES.find((p) => model.includes(p.match)) ?? AI_PRICES[AI_PRICES.length - 1]!;
  const input =
    usage.input_tokens * price.input +
    (usage.cache_creation_input_tokens ?? 0) * price.input * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * price.input * 0.1;
  return Math.ceil((input + usage.output_tokens * price.output) / 1_000_000);
}

/** The seconds Groq bills for a voice note, and what that costs in micro-dollars. */
export function voiceCost(model: string, seconds: number): { seconds: number; microUsd: number } {
  const billed = Math.max(VOICE_MIN_SECONDS, Math.ceil(seconds));
  const perHour = VOICE_PRICES[model] ?? VOICE_PRICES["whisper-large-v3"]!;
  return { seconds: billed, microUsd: Math.ceil((billed * perHour) / 3600) };
}

export interface UsageMeter {
  /** One AI reply for this number. Never throws: a failed count is logged, the reply still goes out. */
  ai(numberId: string | undefined, model: string, usage: AiUsage): void;
  /** One voice note transcribed for this number. */
  voice(numberId: string | undefined, seconds: number): void;
}

/** The Lagos month as its first day, e.g. "2026-10-01". Lagos is UTC+1 all year. */
function lagosMonth(now: Date): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 8) + "01";
}

export function createSupabaseUsageMeter(
  db: SupabaseClient,
  opts: { voiceModel: string; now?: () => Date; log?: Pick<Console, "error"> },
): UsageMeter {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;
  const add = (numberId: string | undefined, counts: Partial<Record<string, number>>) => {
    const row = {
      p_number_id: numberId ?? "",
      p_month: lagosMonth(now()),
      p_ai_replies: 0,
      p_ai_input_tokens: 0,
      p_ai_output_tokens: 0,
      p_ai_micro_usd: 0,
      p_voice_notes: 0,
      p_voice_seconds: 0,
      p_voice_micro_usd: 0,
      ...counts,
    };
    void Promise.resolve(db.rpc("add_usage_cost", row)).then(
      ({ error }) => error && log.error(`Couldn't count usage for number ${row.p_number_id}: ${error.message}`),
      (err) => log.error(`Couldn't count usage for number ${row.p_number_id}:`, err),
    );
  };
  return {
    ai(numberId, model, usage) {
      add(numberId, {
        p_ai_replies: 1,
        p_ai_input_tokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
        p_ai_output_tokens: usage.output_tokens,
        p_ai_micro_usd: aiCostMicroUsd(model, usage),
      });
    },
    voice(numberId, seconds) {
      const cost = voiceCost(opts.voiceModel, seconds);
      add(numberId, { p_voice_notes: 1, p_voice_seconds: cost.seconds, p_voice_micro_usd: cost.microUsd });
    },
  };
}

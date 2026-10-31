import { describe, expect, it } from "vitest";
import { aiCostMicroUsd, createSupabaseUsageMeter, voiceCost } from "./usage.js";

describe("pricing a call", () => {
  it("prices Claude Haiku tokens at $0.10 in and $0.50 out per million", () => {
    // 2,000 in + 100 out = $0.0002 + $0.00005
    expect(aiCostMicroUsd("claude-haiku-5-5", { input_tokens: 2000, output_tokens: 100 })).toBe(250);
  });

  it("bills cache writes above and cache reads below the input price", () => {
    expect(
      aiCostMicroUsd("claude-haiku-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10000 }),
    ).toBe(Math.ceil(125 + 100));
  });

  it("prices a model it doesn't know at the dearest rate, so costs are never understated", () => {
    expect(aiCostMicroUsd("some-new-model", { input_tokens: 1000, output_tokens: 0 })).toBe(4000);
  });

  it("bills a voice note for at least 10 seconds, rounded up", () => {
    expect(voiceCost("whisper-large-v3", 3.2)).toEqual({ seconds: 10, microUsd: 309 });
    expect(voiceCost("whisper-large-v3", 3600)).toEqual({ seconds: 3600, microUsd: 111000 });
  });
});

describe("usage meter", () => {
  function fakeDb(error: { message: string } | null = null) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const db = { rpc: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), { error }) };
    return { db: db as never, calls };
  }
  const now = () => new Date("2026-10-31T23:30:00Z"); // already 1 November in Lagos

  it("adds an AI reply to the number's total for the Lagos month", async () => {
    const { db, calls } = fakeDb();
    createSupabaseUsageMeter(db, { voiceModel: "whisper-large-v3", now }).ai("123", "claude-haiku-5-5", { input_tokens: 2000, output_tokens: 100 });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([
      {
        fn: "add_usage_cost",
        args: {
          p_number_id: "123",
          p_month: "2026-11-01",
          p_ai_replies: 1,
          p_ai_input_tokens: 2000,
          p_ai_output_tokens: 100,
          p_ai_micro_usd: 250,
          p_voice_notes: 0,
          p_voice_seconds: 0,
          p_voice_micro_usd: 0,
        },
      },
    ]);
  });

  it("counts a voice note against the main number when it has no id, and only logs a failure", async () => {
    const { db, calls } = fakeDb({ message: "no table" });
    const errors: unknown[] = [];
    createSupabaseUsageMeter(db, { voiceModel: "whisper-large-v3", now, log: { error: (m: unknown) => errors.push(m) } }).voice(undefined, 30);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]?.args).toMatchObject({ p_number_id: "", p_voice_notes: 1, p_voice_seconds: 30, p_voice_micro_usd: 925 });
    expect(errors).toEqual(["Couldn't count usage for number : no table"]);
  });
});

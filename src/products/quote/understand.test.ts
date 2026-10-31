import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, createClaudeUnderstander } from "./understand.js";

const catalog = [
  { id: "uuid-flyer", name: "Flyers: A5", minQuantity: 50 },
  { id: "uuid-card", name: "Business cards", minQuantity: 100 },
];

function fakeClient(parsed: unknown, stop_reason = "end_turn") {
  const calls: any[] = [];
  const client = {
    messages: {
      parse: async (req: unknown) => {
        calls.push(req);
        return { parsed_output: parsed, stop_reason, usage: { input_tokens: 900, output_tokens: 60 } };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("Claude understander", () => {
  it("maps short refs back to price list ids and drops unknown or bad items", async () => {
    const { client, calls } = fakeClient({
      intent: "quote",
      items: [
        { ref: "p2", quantity: 200 },
        { ref: "p9", quantity: 5 },
        { ref: "p1", quantity: 0 },
      ],
      show: [],
      message: null,
    });
    const ai = createClaudeUnderstander({ apiKey: "x", model: "claude-haiku-5-5", businessName: "KahnPrints", client });
    const result = await ai.understand({
      text: "200 cards",
      history: [
        { direction: "outbound", text: "Welcome!" },
        { direction: "inbound", text: "hi" },
        { direction: "outbound", text: "How can I help?" },
      ],
      catalog,
    });

    expect(result).toEqual({ intent: "quote", items: [{ variantId: "uuid-card", quantity: 200 }], show: [], message: null });
    // Conversation sent to the AI starts with the customer and ends with the new message.
    expect(calls[0].messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(calls[0].messages.at(-1).content).toBe("200 cards");
    expect(calls[0].model).toBe("claude-haiku-5-5");
  });

  it("maps the products a customer asks to see back to price list ids", async () => {
    const { client } = fakeClient({ intent: "catalogue", items: [], show: ["p1", "p7"], message: "Here you go" });
    const ai = createClaudeUnderstander({ apiKey: "x", model: "m", businessName: "KahnPrints", client });
    const result = await ai.understand({ text: "show me your flyers", history: [], catalog });
    expect(result).toMatchObject({ intent: "catalogue", show: ["uuid-flyer"] });
  });

  it("throws when the AI gives no usable answer", async () => {
    const { client } = fakeClient(null, "refusal");
    const ai = createClaudeUnderstander({ apiKey: "x", model: "m", businessName: "KahnPrints", client });
    await expect(ai.understand({ text: "hi", history: [], catalog })).rejects.toThrow();
  });

  it("reports the tokens each call used, even when the answer is unusable", async () => {
    const seen: unknown[] = [];
    const { client } = fakeClient(null, "refusal");
    const ai = createClaudeUnderstander({ apiKey: "x", model: "m", businessName: "KahnPrints", client, onUsage: (u) => seen.push(u) });
    await expect(ai.understand({ text: "hi", history: [], catalog })).rejects.toThrow();
    expect(seen).toEqual([{ input_tokens: 900, output_tokens: 60 }]);
  });

  it("lists items without prices in the instructions", () => {
    const prompt = buildSystemPrompt("KahnPrints", catalog);
    expect(prompt).toContain("- ref p1: Flyers: A5 (minimum 50)");
    expect(prompt).toContain("Never mention a price");
  });

  it("describes each business in its own words", () => {
    expect(buildSystemPrompt("Mama Cakes", catalog, "a bakery")).toContain("Mama Cakes, a bakery in Nigeria");
    expect(buildSystemPrompt("Mama Cakes", catalog)).toContain("Mama Cakes, a business in Nigeria");
  });
});

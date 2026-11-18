import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { buildAdvicePrompt, createClaudeAdviceWriter, numbersIn, onlyGivenNumbers } from "./writer.js";

const FACTS = "Last 30 days:\n• Money in: ₦450,000 (₦380,000), up 18%\n• Orders: 42 (35)";

function fakeClient(text: string) {
  return { messages: { create: async () => ({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }) } } as unknown as Anthropic;
}

const quiet = { warn: () => {}, error: () => {} };
const req = { shopName: "KahnPrints", description: "a print shop", language: "en" as const, facts: FACTS, task: "Advise." };

describe("advice writer", () => {
  it("reads numbers the way they're written", () => {
    expect(numbersIn("₦450,000 is up 18%.\n1. Push flyers\n2. Post on Friday")).toEqual(["450000", "18"]);
  });

  it("only lets through numbers it was given", () => {
    expect(onlyGivenNumbers("Money in is up 18% to ₦450,000 from 42 orders.", FACTS)).toBe(true);
    expect(onlyGivenNumbers("Aim for ₦500,000 next month.", FACTS)).toBe(false);
    expect(onlyGivenNumbers("Give a 10% discount.", FACTS)).toBe(false);
  });

  it("tells the AI the rules and the language", () => {
    const prompt = buildAdvicePrompt({ ...req, language: "fr" });
    expect(prompt).toContain("Never write a number that isn't in them");
    expect(prompt).toContain("Write in French");
  });

  it("returns the advice, and drops one with a made-up figure", async () => {
    const good = createClaudeAdviceWriter({ apiKey: "x", model: "haiku", client: fakeClient("Sales are *up 18%*. Keep pushing flyers."), log: quiet });
    expect(await good.write(req)).toBe("Sales are *up 18%*. Keep pushing flyers.");
    const bad = createClaudeAdviceWriter({ apiKey: "x", model: "haiku", client: fakeClient("Charge ₦1,200 a flyer."), log: quiet });
    expect(await bad.write(req)).toBeNull();
  });
});

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createClaudeSummariser, formatUpdatesForAi } from "./summarise.js";

function fakeClient(parsed: unknown, stop_reason = "end_turn") {
  const calls: any[] = [];
  const client = {
    messages: {
      parse: async (req: unknown) => {
        calls.push(req);
        return { parsed_output: parsed, stop_reason };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const updates = [
  { time: "09:14", who: "Tunde", kind: "text" as const, text: "Slab don finish" },
  { time: "10:02", who: "Tunde", kind: "photo" as const, text: null },
];

describe("Claude summariser", () => {
  it("labels each update with its time, sender and type", () => {
    expect(formatUpdatesForAi(updates)).toBe(
      "[09:14] Tunde (message): Slab don finish\n[10:02] Tunde (photo): (no caption)",
    );
  });

  it("sends the day's updates to the model and returns its sections", async () => {
    const summary = { overview: "Slab finished.", workDone: ["Slab cast"], problems: [], materialsNeeded: [], nextSteps: [] };
    const { client, calls } = fakeClient(summary);
    const ai = createClaudeSummariser({ apiKey: "x", model: "claude-haiku-5-5", client });
    expect(await ai.summarise({ siteName: "Lekki Block B", date: "Sat 10 Oct 2026", updates })).toEqual(summary);
    expect(calls[0].model).toBe("claude-haiku-5-5");
    expect(calls[0].messages[0].content).toContain("Site: Lekki Block B");
  });

  it("fails loudly when the model refuses", async () => {
    const { client } = fakeClient(null, "refusal");
    const ai = createClaudeSummariser({ apiKey: "x", model: "m", client });
    await expect(ai.summarise({ siteName: "S", date: "d", updates })).rejects.toThrow();
  });
});

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createWishWriter, fallbackWish } from "./wish.js";

const silent = { error: () => {} };

function fakeClient(reply: { text?: string; stop_reason?: string; fail?: boolean }) {
  const calls: any[] = [];
  const client = {
    messages: {
      create: async (req: unknown) => {
        calls.push(req);
        if (reply.fail) throw new Error("AI down");
        return { content: [{ type: "text", text: reply.text ?? "" }], stop_reason: reply.stop_reason ?? "end_turn" };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("birthday messages", () => {
  it("asks the AI for a message with the name and group", async () => {
    const { client, calls } = fakeClient({ text: "Happy birthday Ada! 🎉" });
    const writer = createWishWriter({ model: "m", client, log: silent });
    expect(await writer.write({ name: "Ada Okafor", groupName: "Class of 2010" })).toBe("Happy birthday Ada! 🎉");
    expect(calls[0].messages[0].content).toBe("Name: Ada Okafor\nGroup: Class of 2010");
  });

  it("uses a ready-made message when the AI fails or is off", async () => {
    const expected = fallbackWish("Ada Okafor", "Class of 2010");
    expect(expected).toContain("Ada");
    expect(expected).toContain("Class of 2010");
    expect(expected).not.toContain("Okafor");
    for (const reply of [{ fail: true }, { text: "" }, { text: "cut off", stop_reason: "max_tokens" }]) {
      const writer = createWishWriter({ model: "m", client: fakeClient(reply).client, log: silent });
      expect(await writer.write({ name: "Ada Okafor", groupName: "Class of 2010" })).toBe(expected);
    }
    expect(await createWishWriter({ model: "m" }).write({ name: "Ada Okafor", groupName: "Class of 2010" })).toBe(expected);
  });
});

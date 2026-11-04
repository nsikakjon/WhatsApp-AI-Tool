import { describe, expect, it } from "vitest";
import type { Product, ProductContext, Reply } from "./product.js";
import type { IncomingMessage } from "./whatsapp/types.js";
import { withUnclearLimit } from "./unclear-limit.js";

const ctx = {} as ProductContext;
const msg = (text: string, from = "2348011111111"): IncomingMessage => ({ waMessageId: text, from, type: "text", text, businessNumberId: "num" });

// Anything starting "order" is understood; everything else is unclear.
const bot: Product = {
  name: "test",
  async handle(m) {
    return m.text!.startsWith("order") ? { text: "Here's your quote" } : { text: "Sorry, what would you like?", stage: "unclear" };
  },
};

function setup() {
  let at = new Date("2026-11-04T12:00:00Z").getTime();
  const limited = withUnclearLimit(bot, { now: () => new Date(at) });
  return {
    send: (text: string, from?: string) => limited.handle(msg(text, from), ctx),
    wait: (hours: number) => (at += hours * 3_600_000),
  };
}

describe("withUnclearLimit", () => {
  it("answers two unclear messages, then stays quiet", async () => {
    const chat = setup();
    expect(await chat.send("Hmmm")).toEqual<Reply>({ text: "Sorry, what would you like?" });
    expect(await chat.send("Haba")).not.toBeNull();
    expect(await chat.send("asdfgh")).toBeNull();
    chat.wait(5);
    expect(await chat.send("islamabad")).toBeNull();
  });

  it("answers again 6 hours after its last reply", async () => {
    const chat = setup();
    await chat.send("Hmmm");
    await chat.send("Haba");
    chat.wait(6);
    expect(await chat.send("jk")).not.toBeNull();
    expect(await chat.send("jk again")).not.toBeNull();
    expect(await chat.send("jk once more")).toBeNull();
  });

  it("always answers a clear message, and that starts the count again", async () => {
    const chat = setup();
    await chat.send("Hmmm");
    await chat.send("Haba");
    expect(await chat.send("order 10 mugs")).toEqual({ text: "Here's your quote" });
    expect(await chat.send("Hmmm")).not.toBeNull();
    expect(await chat.send("Haba")).not.toBeNull();
    expect(await chat.send("zzz")).toBeNull();
  });

  it("counts each chat on its own", async () => {
    const chat = setup();
    await chat.send("Hmmm");
    await chat.send("Haba");
    expect(await chat.send("hello?", "2348022222222")).not.toBeNull();
  });
});

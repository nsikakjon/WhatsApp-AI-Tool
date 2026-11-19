import { describe, expect, it } from "vitest";
import type { Product, ProductContext } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { backInStockAsk, backInStockRef, sendDueStockAlerts, withStockAlerts, type DueAlert, type StockAlertStore, type WaitingOption } from "./stock-alerts.js";

const VARIANT = "1a2b3c4d-0000-4000-8000-000000000001";

function memory(options: WaitingOption[], due: DueAlert[] = []) {
  const waits: Array<{ variantId: string; contactId: string; waId: string; fromNumberId: string | null }> = [];
  const sent: string[] = [];
  const store: StockAlertStore = {
    async option(_b, ref) {
      return options.find((o) => o.variantId.replace(/-/g, "").startsWith(ref)) ?? null;
    },
    async wait(a) {
      if (!waits.some((w) => w.variantId === a.variantId && w.contactId === a.contactId)) waits.push(a);
    },
    async due() {
      return due.filter((d) => !sent.includes(d.id));
    },
    async markSent(id) {
      sent.push(id);
    },
    async expire() {
      return 0;
    },
  };
  return { store, waits, sent };
}

const inner: Product = { name: "quote", handle: async () => ({ text: "bot" }) };
const ctx = { contactId: "c1" } as ProductContext;
const msg = (text: string) => ({ waMessageId: "w1", from: "2348099990000", businessNumberId: "n1", type: "text", text, timestamp: new Date() }) as IncomingMessage;

describe("tell me when it's back", () => {
  it("reads the ref back from the message the shop typed, in English and French", () => {
    expect(backInStockRef(backInStockAsk("en", "Flyers: A4", VARIANT))).toBe("1a2b3c4d");
    expect(backInStockRef(backInStockAsk("fr", "Flyers: A4", VARIANT))).toBe("1a2b3c4d");
    expect(backInStockRef("Please tell me when you open")).toBeNull();
  });

  it("saves the wait once for a sold-out option, and lets other messages through", async () => {
    const { store, waits } = memory([{ variantId: VARIANT, name: "Flyers: A4", stock: 0 }]);
    const bot = withStockAlerts(inner, { businessId: "b1", businessName: "Ada's Prints", lang: "en", store });
    const ask = backInStockAsk("en", "Flyers: A4", VARIANT);
    expect((await bot.handle(msg(ask), ctx)).text).toContain("Ada's Prints will message you here as soon as Flyers: A4 is back");
    await bot.handle(msg(ask), ctx);
    expect(waits).toEqual([{ businessId: "b1", variantId: VARIANT, contactId: "c1", waId: "2348099990000", fromNumberId: "n1" }]);
    expect((await bot.handle(msg("How much for 100 flyers?"), ctx)).text).toBe("bot");
  });

  it("says so when the option already has stock", async () => {
    const { store, waits } = memory([{ variantId: VARIANT, name: "Flyers: A4", stock: 4 }]);
    const bot = withStockAlerts(inner, { businessId: "b1", businessName: "Ada's Prints", lang: "en", store });
    expect((await bot.handle(msg(backInStockAsk("en", "Flyers: A4", VARIANT)), ctx)).text).toContain("is in stock right now");
    expect(waits).toEqual([]);
  });

  it("messages each waiting customer once, and keeps those it can't reach yet", async () => {
    const due: DueAlert[] = [
      { id: "a1", businessId: "b1", businessName: "Ada's Prints", waId: "234801", fromNumberId: "n1", option: "Flyers: A4", lang: "en" },
      { id: "a2", businessId: "b1", businessName: "Ada's Prints", waId: "234802", fromNumberId: "n1", option: "Flyers: A4", lang: "en" },
    ];
    const { store, sent } = memory([], due);
    const texts: string[] = [];
    const send = async (a: DueAlert, text: string) => {
      if (a.waId === "234802") return false;
      texts.push(text);
      return true;
    };
    expect(await sendDueStockAlerts({ store, send, log: { error() {}, info() {} } })).toBe(1);
    expect(await sendDueStockAlerts({ store, send, log: { error() {}, info() {} } })).toBe(0);
    expect(sent).toEqual(["a1"]);
    expect(texts).toEqual(["Good news from Ada's Prints: Flyers: A4 is back in stock. Reply with how many you'd like and we'll send your quote."]);
  });
});

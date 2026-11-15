import { describe, expect, it } from "vitest";
import type { Product, ProductContext } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { cleanKeyword, keywordIn, withSharedLine, type LineGuest, type LineGuestStore } from "./shared-line.js";
import type { QuoteBusiness } from "./store.js";

const LINE = "line-1";
const shop = (id: string, name: string, keyword: string): QuoteBusiness => ({
  id,
  name,
  description: null,
  orderPrefix: "EV",
  phoneNumberId: null,
  ownerWaId: null,
  businessDetails: null,
  paymentDetails: null,
  active: false,
  lineKeyword: keyword,
  updatedAt: new Date("2026-11-01"),
});
const SHOPS = [shop("tedx", "TEDxUNIUYO", "tedxuniuyo"), shop("fest", "Ibom Fest", "ibomfest")];

function memoryGuests(): LineGuestStore & { rows: Map<string, LineGuest> } {
  const rows = new Map<string, LineGuest>();
  return {
    rows,
    keywords: async () => new Map(SHOPS.map((s) => [s.lineKeyword!, s.id])),
    current: async (waId) => rows.get(waId) ?? null,
    async set(waId, _n, businessId, at) {
      if (businessId) rows.set(waId, { businessId, lastAt: at });
      else rows.delete(waId);
    },
  };
}

function setup(opts: { busy?: boolean; now?: Date } = {}) {
  const store = memoryGuests();
  const seen: string[] = [];
  const bot = (name: string): Product => ({ name, handle: async (m) => (seen.push(`${name}:${m.text}`), { text: `${name} bot` }) });
  let clock = opts.now ?? new Date("2026-11-20T10:00:00Z");
  const product = withSharedLine(bot("line"), {
    numberId: LINE,
    store,
    businesses: { get: async (id) => SHOPS.find((s) => s.id === id) ?? null },
    build: (b) => bot(b.name),
    busy: async () => opts.busy ?? false,
    now: () => clock,
    log: { error() {} },
  });
  const send = (text: string, to = LINE) =>
    product.handle({ from: "2348011111111", text, type: "text", businessNumberId: to } as IncomingMessage, {} as ProductContext);
  return { send, seen, store, later: (days: number) => (clock = new Date(clock.getTime() + days * 86_400_000)) };
}

describe("partners on the yarnOga line", () => {
  it("finds a keyword in a short message, however it's typed", () => {
    const known = new Map([["tedxuniuyo", "tedx"]]);
    expect(keywordIn("TEDxUNIUYO", known)).toBe("tedxuniuyo");
    expect(keywordIn("Hi tedxuniuyo!", known)).toBe("tedxuniuyo");
    expect(keywordIn("I heard about you at tedxuniuyo last year and want prices", known)).toBeNull();
    expect(keywordIn("hello", known)).toBeNull();
    expect(cleanKeyword(" TEDx UNIUYO ")).toBe("tedxuniuyo");
    expect(cleanKeyword("ab")).toBeNull();
    expect(cleanKeyword("tedx_uniuyo")).toBeNull();
  });

  it("hands a visitor to the partner's bot after its keyword and keeps them there", async () => {
    const t = setup();
    expect(await t.send("TEDxUNIUYO")).toEqual({ text: "TEDxUNIUYO bot" });
    await t.send("how much is a ticket?");
    expect(t.seen).toEqual(["TEDxUNIUYO:hi", "TEDxUNIUYO:how much is a ticket?"]);
  });

  it("lets them leave, switch partner, or sign up", async () => {
    const t = setup();
    await t.send("tedxuniuyo");
    expect(await t.send("exit")).toEqual({ text: "You've left the TEDxUNIUYO chat. Send *TEDXUNIUYO* to go back." });
    expect(await t.send("hello")).toEqual({ text: "line bot" });

    await t.send("tedxuniuyo");
    await t.send("ibomfest");
    expect(await t.send("menu")).toEqual({ text: "Ibom Fest bot" });

    expect(await t.send("sign up")).toEqual({ text: "line bot" });
    expect(t.store.rows.size).toBe(0);
  });

  it("lets go after two quiet weeks", async () => {
    const t = setup();
    await t.send("tedxuniuyo");
    t.later(15);
    expect(await t.send("hi")).toEqual({ text: "line bot" });
  });

  it("leaves people signing up, and other numbers, alone", async () => {
    const busy = setup({ busy: true });
    expect(await busy.send("TEDXUNIUYO")).toEqual({ text: "line bot" });
    const other = setup();
    expect(await other.send("tedxuniuyo", "another-number")).toEqual({ text: "line bot" });
  });
});

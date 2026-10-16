import { describe, expect, it } from "vitest";
import type { Product, ProductContext } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { createQuoteRouter } from "./businesses.js";
import type { BusinessStore, QuoteBusiness } from "./store.js";

function business(over: Partial<QuoteBusiness> = {}): QuoteBusiness {
  return {
    id: "b2",
    name: "Mama Cakes",
    description: "a bakery",
    orderPrefix: "MC",
    phoneNumberId: "num-b2",
    ownerWaId: "2348000000002",
    businessDetails: null,
    paymentDetails: null,
    active: true,
    updatedAt: new Date("2026-10-16T10:00:00Z"),
    ...over,
  };
}

function memoryBusinesses(list: QuoteBusiness[]) {
  let lookups = 0;
  const store: BusinessStore = {
    async findByPhoneNumberId(id) {
      lookups++;
      return list.find((b) => b.phoneNumberId === id) ?? null;
    },
    async get(id) {
      return list.find((b) => b.id === id) ?? null;
    },
    async list() {
      return list;
    },
  };
  return { store, lookups: () => lookups };
}

const named = (name: string): Product => ({ name, handle: async () => ({ text: name }) });

function msg(businessNumberId?: string): IncomingMessage {
  return { waMessageId: "w1", from: "2348012345678", businessNumberId, type: "text", text: "hi", timestamp: 0, raw: {} };
}

const ctx = {} as ProductContext;

describe("quote router", () => {
  it("answers a business's own number with that business's bot", async () => {
    const built: string[] = [];
    const router = createQuoteRouter({
      businesses: memoryBusinesses([business()]).store,
      fallback: named("main"),
      build: (b) => {
        built.push(b.name);
        return named(`bot for ${b.name}`);
      },
    });
    expect(await router.handle(msg("num-b2"), ctx)).toEqual({ text: "bot for Mama Cakes" });
    expect(built).toEqual(["Mama Cakes"]);
  });

  it("sends every other number to the main bot, as before", async () => {
    const router = createQuoteRouter({ businesses: memoryBusinesses([business()]).store, fallback: named("main"), build: () => named("other") });
    expect(await router.handle(msg("main-number"), ctx)).toEqual({ text: "main" });
    expect(await router.handle(msg(undefined), ctx)).toEqual({ text: "main" });
  });

  it("never lets a business row take over the main number", async () => {
    const router = createQuoteRouter({
      businesses: memoryBusinesses([business({ phoneNumberId: "main-number" })]).store,
      fallback: named("main"),
      fallbackNumberIds: ["main-number"],
      build: () => named("other"),
    });
    expect(await router.handle(msg("main-number"), ctx)).toEqual({ text: "main" });
  });

  it("falls back to the main bot when the businesses table can't be read", async () => {
    const errors: unknown[] = [];
    const router = createQuoteRouter({
      businesses: { ...memoryBusinesses([]).store, findByPhoneNumberId: async () => Promise.reject(new Error("no table")) },
      fallback: named("main"),
      build: () => named("other"),
      log: { error: (...args: unknown[]) => errors.push(args) },
    });
    expect(await router.handle(msg("num-b2"), ctx)).toEqual({ text: "main" });
    expect(errors).toHaveLength(1);
  });

  it("stays silent for a switched-off business instead of answering as another", async () => {
    const router = createQuoteRouter({
      businesses: memoryBusinesses([business({ active: false })]).store,
      fallback: named("main"),
      build: () => named("other"),
    });
    expect(await router.handle(msg("num-b2"), ctx)).toBeNull();
  });

  it("remembers lookups for a minute and rebuilds a bot when its settings change", async () => {
    const list = [business()];
    const store = memoryBusinesses(list);
    let clock = 0;
    let builds = 0;
    const router = createQuoteRouter({
      businesses: store.store,
      fallback: named("main"),
      build: (b) => {
        builds++;
        return named(b.name);
      },
      now: () => clock,
    });
    await router.handle(msg("num-b2"), ctx);
    await router.handle(msg("num-b2"), ctx);
    expect(store.lookups()).toBe(1);
    expect(builds).toBe(1);

    list[0] = business({ name: "Mama Cakes Ltd", updatedAt: new Date("2026-10-16T11:00:00Z") });
    clock = 61_000;
    expect(await router.handle(msg("num-b2"), ctx)).toEqual({ text: "Mama Cakes Ltd" });
    expect(store.lookups()).toBe(2);
    expect(builds).toBe(2);
  });
});

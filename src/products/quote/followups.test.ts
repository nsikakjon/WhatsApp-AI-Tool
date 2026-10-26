import { describe, expect, it } from "vitest";
import {
  followUpTemplateParams,
  followUpText,
  isStopRequest,
  lagosHour,
  sendDueFollowUps,
  type DueQuote,
  type FollowUpDeps,
  type FollowUpStore,
  type FollowUpTarget,
} from "./followups.js";
import { DEFAULT_BUSINESS_ID } from "./store.js";

// 10:00 in Lagos (09:00 UTC).
const NOW = new Date("2026-10-17T09:00:00Z");
const HOUR = 60 * 60 * 1000;

const target: FollowUpTarget = { businessName: "Demo Shop", orderPrefix: "DS", hours: 24, phoneNumberId: "pn-1" };

function quote(over: Partial<DueQuote> = {}): DueQuote {
  return {
    id: "o1",
    orderNumber: 1001,
    totalKobo: 1_500_000,
    contactId: "c1",
    customerWaId: "2348012345678",
    customerName: "Ada",
    createdAt: new Date(NOW.getTime() - 25 * HOUR),
    ...over,
  };
}

function memoryStore(quotes: DueQuote[]) {
  const decided = new Map<string, string>();
  const optOuts = new Set<string>();
  const queries: Array<{ businessId?: string; after: Date; before: Date }> = [];
  const store: FollowUpStore = {
    async dueQuotes(businessId, after, before) {
      queries.push({ businessId, after, before });
      return quotes.filter((q) => !decided.has(q.id) && q.createdAt >= after && q.createdAt <= before);
    },
    async decide(id, status) {
      if (decided.has(id)) return false;
      decided.set(id, status);
      return true;
    },
    async markFailed(id) {
      decided.set(id, "failed");
    },
    async optedOut(businessId, contactId) {
      return optOuts.has(`${businessId}/${contactId}`);
    },
    async optOut(businessId, contactId) {
      optOuts.add(`${businessId}/${contactId}`);
    },
    async businessHours() {
      return new Map();
    },
  };
  return { store, decided, optOuts, queries };
}

function deps(store: FollowUpStore, over: Partial<FollowUpDeps> = {}) {
  const texts: Array<{ to: string; text: string; from?: string }> = [];
  const templates: Array<{ to: string; params: string[]; from?: string }> = [];
  const d: FollowUpDeps = {
    store,
    lastInboundAt: async () => new Date(NOW.getTime() - 25.5 * HOUR),
    canMessageFreely: async () => false,
    isPaused: async () => false,
    sendText: async (to, text, from) => {
      texts.push({ to, text, from });
    },
    sendTemplate: async (to, params, from) => {
      templates.push({ to, params, from });
    },
    now: () => NOW,
    log: { error: () => {} },
    ...over,
  };
  return { d, texts, templates };
}

describe("sendDueFollowUps", () => {
  it("sends the approved template to a customer outside the 24-hour window, once", async () => {
    const { store, decided } = memoryStore([quote()]);
    const { d, templates, texts } = deps(store);

    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(templates).toEqual([{ to: "2348012345678", params: ["Ada", "Demo Shop", "DS-1001", "₦15,000"], from: "pn-1" }]);
    expect(texts).toEqual([]);
    expect(decided.get("o1")).toBe("sent");

    // The next run sends nothing more.
    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(templates).toHaveLength(1);
  });

  it("sends an ordinary message while the 24-hour window is open", async () => {
    const { store } = memoryStore([quote()]);
    const { d, templates, texts } = deps(store, { canMessageFreely: async () => true });
    await sendDueFollowUps(target, d);
    expect(templates).toEqual([]);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toContain("DS-1001");
    expect(texts[0]!.text).toContain("₦15,000");
    expect(texts[0]!.text).toContain("STOP");
  });

  it("only looks at quotes past the delay and not more than two days late", async () => {
    const { store, queries } = memoryStore([]);
    await sendDueFollowUps(target, deps(store).d);
    expect(queries[0]!.before).toEqual(new Date(NOW.getTime() - 24 * HOUR));
    expect(queries[0]!.after).toEqual(new Date(NOW.getTime() - 72 * HOUR));
  });

  it("skips customers who messaged after the quote", async () => {
    const { store, decided } = memoryStore([quote()]);
    const { d, templates } = deps(store, { lastInboundAt: async () => new Date(NOW.getTime() - 2 * HOUR) });
    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(templates).toEqual([]);
    expect(decided.get("o1")).toBe("skipped");
  });

  it("skips customers who replied STOP to this business", async () => {
    const { store, optOuts } = memoryStore([quote()]);
    optOuts.add(`${DEFAULT_BUSINESS_ID}/c1`);
    const { d, templates } = deps(store);
    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(templates).toEqual([]);
  });

  it("skips chats staff have taken over", async () => {
    const { store } = memoryStore([quote()]);
    const { d, templates } = deps(store, { isPaused: async () => true });
    expect((await sendDueFollowUps(target, d)).skipped).toBe(1);
    expect(templates).toEqual([]);
  });

  it("skips customers outside the window when no template is set up", async () => {
    const { store } = memoryStore([quote()]);
    const { d, texts } = deps(store, { sendTemplate: undefined });
    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(texts).toEqual([]);
  });

  it("sends nothing at night in Lagos", async () => {
    const { store } = memoryStore([quote({ createdAt: new Date("2026-10-15T21:00:00Z") })]);
    const night = new Date("2026-10-16T22:30:00Z"); // 23:30 in Lagos
    const { d, templates } = deps(store, { now: () => night });
    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(templates).toEqual([]);
  });

  it("sends nothing when the business's plan doesn't include follow-ups, or hours is 0", async () => {
    const { store } = memoryStore([quote()]);
    const { d, templates } = deps(store, { allowed: async () => false });
    await sendDueFollowUps(target, d);
    await sendDueFollowUps({ ...target, hours: 0 }, deps(store).d);
    expect(templates).toEqual([]);
  });

  it("marks a reminder WhatsApp refused as failed and never retries it", async () => {
    const { store, decided } = memoryStore([quote()]);
    const { d } = deps(store, {
      sendTemplate: async () => {
        throw new Error("template not approved");
      },
    });
    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(decided.get("o1")).toBe("failed");
    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 0, skipped: 0, failed: 0 });
  });

  it("doesn't send when another server already claimed the quote", async () => {
    const { store } = memoryStore([quote()]);
    const claimed: FollowUpStore = { ...store, decide: async () => false };
    const { d, templates } = deps(claimed);
    expect(await sendDueFollowUps(target, d)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(templates).toEqual([]);
  });

  it("keeps opt-outs per business", async () => {
    const { store, optOuts } = memoryStore([quote()]);
    optOuts.add(`${DEFAULT_BUSINESS_ID}/c1`);
    const { d, templates } = deps(store);
    expect((await sendDueFollowUps({ ...target, businessId: "biz-2" }, d)).sent).toBe(1);
    expect(templates).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("knows Lagos time", () => {
    expect(lagosHour(new Date("2026-10-17T07:00:00Z"))).toBe(8);
    expect(lagosHour(new Date("2026-10-17T23:30:00Z"))).toBe(0);
  });

  it("recognises STOP but not ordinary messages", () => {
    for (const t of ["STOP", "stop.", " Stop reminders ", "unsubscribe"]) expect(isStopRequest(t)).toBe(true);
    for (const t of ["stop the order", "don't stop", "", undefined]) expect(isStopRequest(t)).toBe(false);
  });

  it("uses 'there' in the template when the customer has no name", () => {
    expect(followUpTemplateParams(target, quote({ customerName: null }))[0]).toBe("there");
    expect(followUpText(target, quote({ customerName: null }))).toMatch(/^Hi, just checking in/);
  });

  it("reminds in French, in CFA francs, for a French business", () => {
    const fr = { ...target, language: "fr" as const, currency: "XOF" as const };
    const text = followUpText(fr, quote({ customerName: "Awa" }));
    expect(text).toMatch(/^Bonjour Awa, je reviens vers vous/);
    expect(text).toContain("FCFA");
    expect(text).toContain("Répondez STOP");
    for (const t of ["Arrêter", "plus de rappels"]) expect(isStopRequest(t)).toBe(true);
  });
});

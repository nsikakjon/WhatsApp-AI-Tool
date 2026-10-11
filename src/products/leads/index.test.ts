import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { createLeadQualifier, formatLeadList } from "./index.js";
import { EMPTY_DETAILS, scoreLead, type LeadDetails } from "./qualify.js";
import type { Lead, LeadStore } from "./store.js";
import { toUnderstanding, type LeadUnderstander, type Understanding } from "./understand.js";

const silent = { info() {}, error() {} };
const AGENT = "2348099999999";
const BUYER = "2348011111111";

function memoryStore() {
  const leads = new Map<string, Lead>();
  let n = 0;
  const store: LeadStore = {
    async findLead(waId) {
      return leads.get(waId) ?? null;
    },
    async saveLead(waId, l) {
      const prev = leads.get(waId);
      const lead: Lead = {
        ...l,
        id: prev?.id ?? `lead${++n}`,
        waId,
        alertedAt: prev?.alertedAt ?? null,
        updatedAt: new Date(),
      };
      leads.set(waId, lead);
      return lead;
    },
    async claimAlert(id) {
      const lead = [...leads.values()].find((l) => l.id === id)!;
      if (lead.alertedAt) return false;
      lead.alertedAt = new Date();
      lead.status = "handed_off";
      return true;
    },
    async recentLeads(limit) {
      return [...leads.values()].slice(0, limit);
    },
  };
  return { store, leads };
}

/** A fake AI that returns scripted answers, one per message. */
function scriptedAi(script: Array<Partial<Understanding["details"]> & { wantsAgent?: boolean; message?: string } | Error>) {
  const calls: Array<Parameters<LeadUnderstander["understand"]>[0]> = [];
  const ai: LeadUnderstander = {
    async understand(input) {
      calls.push(input);
      const step = script.shift() ?? {};
      if (step instanceof Error) throw step;
      const { wantsAgent = false, message = "Next question?", ...details } = step;
      return { details: { ...EMPTY_DETAILS, ...details }, wantsAgent, message };
    },
  };
  return { ai, calls };
}

function setup(script: Parameters<typeof scriptedAi>[0]) {
  const mem = memoryStore();
  const { ai, calls } = scriptedAi(script);
  const bot = createLeadQualifier({ store: mem.store, ai, businessName: "Acme Homes", agentWaIds: [AGENT], log: silent });
  return { bot, calls, ...mem };
}

let n = 0;
function msg(from: string, fields: Partial<IncomingMessage>): IncomingMessage {
  return { waMessageId: `wamid.${++n}`, from, type: "text", timestamp: 0, raw: {}, ...fields };
}
const ctx = { contactId: "c1", history: [], downloadMedia: async () => ({ data: new Blob([]), mimeType: "" }) };

const ALL_ANSWERS: Partial<LeadDetails> = {
  purpose: "buy",
  propertyType: "4 bedroom duplex",
  location: "Lekki",
  budgetKobo: 150_000_000_00,
  timeline: "now",
  financing: "cash",
};

describe("lead qualifier: asking questions", () => {
  it("saves answers, uses the WhatsApp name, and asks the AI's next question", async () => {
    const { bot, leads, calls } = setup([{ purpose: "buy", location: "Lekki", message: "What type of property?" }]);
    const reply = await bot.handle(msg(BUYER, { text: "I want to buy in Lekki", contactName: "Ada" }), ctx);
    expect(reply?.text).toBe("What type of property?");
    expect(reply?.notify).toBeUndefined();
    const lead = leads.get(BUYER)!;
    expect(lead).toMatchObject({ name: "Ada", purpose: "buy", location: "Lekki", status: "qualifying", temperature: "cold" });
    expect(calls[0]!.missing).toEqual(["purpose", "propertyType", "location", "budgetKobo", "timeline", "financing"]);
  });

  it("keeps earlier answers when the next message doesn't repeat them", async () => {
    const { bot, leads, calls } = setup([{ purpose: "rent" }, { location: "Yaba" }]);
    await bot.handle(msg(BUYER, { text: "rent" }), ctx);
    await bot.handle(msg(BUYER, { text: "Yaba" }), ctx);
    expect(leads.get(BUYER)).toMatchObject({ purpose: "rent", location: "Yaba" });
    expect(calls[1]!.known.purpose).toBe("rent");
  });

  it("falls back to its own question when the AI fails", async () => {
    const { bot } = setup([new Error("AI down")]);
    const reply = await bot.handle(msg(BUYER, { text: "hello" }), ctx);
    expect(reply?.text).toBe("Are you looking to buy or to rent?");
  });

  it("works with voice notes, and asks to type when one couldn't be understood", async () => {
    const { bot, leads } = setup([{ purpose: "buy" }]);
    const unclear = await bot.handle(msg(BUYER, { type: "audio", mediaId: "a1" }), ctx);
    expect(unclear?.text).toContain("type your message");
    await bot.handle(msg(BUYER, { type: "audio", text: "I wan buy house", transcribed: true }), ctx);
    expect(leads.get(BUYER)?.purpose).toBe("buy");
  });
});

describe("lead qualifier: handing over to agents", () => {
  it("alerts agents once when a lead turns hot", async () => {
    const { bot, leads } = setup([{ ...ALL_ANSWERS }, { message: "An agent will call you." }]);
    const reply = await bot.handle(msg(BUYER, { text: "everything", contactName: "Ada" }), ctx);
    expect(reply?.text).toContain("An agent from Acme Homes will contact you shortly");
    expect(reply?.text).toContain("Budget: ₦150,000,000");
    expect(reply?.notify).toHaveLength(1);
    expect(reply?.notify![0]!.to).toBe(AGENT);
    expect(reply?.notify![0]!.text).toContain("🔥 HOT lead, score 95/100");
    expect(reply?.notify![0]!.text).toContain("https://wa.me/2348011111111");
    expect(leads.get(BUYER)?.status).toBe("handed_off");

    // Later messages are passed on, not a second alert.
    const later = await bot.handle(msg(BUYER, { text: "Can I see it Saturday?" }), ctx);
    expect(later?.text).toBe("An agent will call you.");
    expect(later?.notify![0]!.text).toContain('wrote:\n"Can I see it Saturday?"');
    expect(later?.notify![0]!.text).not.toContain("HOT lead");
  });

  it("alerts agents straight away when someone asks for an agent", async () => {
    const { bot } = setup([{ wantsAgent: true }]);
    const reply = await bot.handle(msg(BUYER, { text: "I want to talk to someone" }), ctx);
    expect(reply?.notify![0]!.text).toContain("Asked to speak to an agent");
    expect(reply?.notify![0]!.text).toContain("Not answered yet: purpose");
  });

  it("doesn't alert for a complete but cold lead; sends a summary instead", async () => {
    const { bot } = setup([{ ...ALL_ANSWERS, timeline: "just looking", financing: "unsure" }]);
    const reply = await bot.handle(msg(BUYER, { text: "just looking" }), ctx);
    expect(reply?.notify).toBeUndefined();
    expect(reply?.text).toContain("Here's what I've noted");
    expect(reply?.text).toContain('Reply "agent"');
  });
});

describe("lead qualifier: agents", () => {
  it("lists the latest leads for agents who text 'leads'", async () => {
    const { bot } = setup([{ purpose: "buy", location: "Lekki" }]);
    await bot.handle(msg(BUYER, { text: "buy in Lekki", contactName: "Ada" }), ctx);
    const reply = await bot.handle(msg(AGENT, { text: " Leads " }), ctx);
    expect(reply?.text).toContain("*Latest 1 leads*");
    expect(reply?.text).toContain("Ada (+2348011111111)");
  });

  it("treats 'leads' from anyone else as a normal message", async () => {
    const { bot, calls } = setup([{}]);
    await bot.handle(msg(BUYER, { text: "leads" }), ctx);
    expect(calls).toHaveLength(1);
  });

  it("says so when there are no leads", () => {
    expect(formatLeadList([])).toBe("No leads yet.");
  });
});

describe("scoring", () => {
  it("scores in code: timeline and financing count most", () => {
    const full = { ...EMPTY_DETAILS, ...ALL_ANSWERS } as LeadDetails;
    expect(scoreLead(full, false)).toEqual({ score: 95, temperature: "hot" });
    expect(scoreLead(full, true).score).toBe(100);
    expect(scoreLead({ ...full, timeline: "3-6 months", financing: "needs mortgage" }, false)).toEqual({
      score: 55,
      temperature: "warm",
    });
    expect(scoreLead(EMPTY_DETAILS, false)).toEqual({ score: 0, temperature: "cold" });
  });

  it("turns the AI's naira budget into whole kobo", () => {
    const base = { name: null, purpose: null, propertyType: null, location: null, timeline: null, financing: null, wantsAgent: false, message: "ok" } as const;
    expect(toUnderstanding({ ...base, budgetNaira: 50_000_000 }).details.budgetKobo).toBe(5_000_000_000);
    expect(toUnderstanding({ ...base, budgetNaira: -5 }).details.budgetKobo).toBeNull();
    expect(toUnderstanding({ ...base, budgetNaira: null }).details.budgetKobo).toBeNull();
  });

  it("ignores answers outside the allowed choices instead of failing", () => {
    const base = { name: null, propertyType: null, location: null, budgetNaira: null, wantsAgent: false, message: "ok" };
    const u = toUnderstanding({ ...base, purpose: "Buy", timeline: "next week", financing: "cash" });
    expect(u.details).toMatchObject({ purpose: "buy", timeline: null, financing: "cash" });
  });
});

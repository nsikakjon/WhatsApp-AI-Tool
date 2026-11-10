import { describe, expect, it } from "vitest";
import type { Signup } from "./chat-signup.js";
import { sendDemoFollowUps, type DemoFollowUpDeps, type QuietVisitor } from "./demo-followup.js";

// 10am in Lagos.
const MORNING = new Date("2026-11-10T09:00:00Z");

function signup(change: Partial<Signup>): Signup {
  return { waId: "", step: "name", businessName: null, description: null, referralCode: null, draftCsv: null, businessId: null, trying: false, aiDay: null, aiUsed: 0, ...change };
}

function setup(visitors: QuietVisitor[], signups: Record<string, Signup> = {}, paused: string[] = []) {
  const claimed = new Set<string>();
  const sent: Array<{ to: string; body: string; buttons: string[] }> = [];
  let asked: { from: Date; to: Date } | null = null;
  const deps: DemoFollowUpDeps = {
    numberId: "num-quotes",
    store: {
      async quiet(_, from, to) {
        asked = { from, to };
        return visitors.filter((v) => !claimed.has(v.contactId));
      },
      async claim(contactId) {
        if (claimed.has(contactId)) return false;
        claimed.add(contactId);
        return true;
      },
    },
    signup: async (waId) => signups[waId] ?? null,
    isPaused: async (contactId) => paused.includes(contactId),
    sendText: async (to, body) => void sent.push({ to, body, buttons: [] }),
    sendButtons: async (to, m) => void sent.push({ to, body: m.body, buttons: m.buttons.map((b) => b.id) }),
    alertWaId: "2340000000000",
    now: MORNING,
    log: { error: () => {} },
  };
  return { deps, sent, asked: () => asked };
}

const ADA = { contactId: "c-ada", waId: "2348011111111", name: "Ada Obi" };

describe("demo follow-ups", () => {
  it("offers sign-up once to a visitor who went quiet 3 to 22 hours ago", async () => {
    const { deps, sent, asked } = setup([ADA]);
    expect(await sendDemoFollowUps(deps)).toBe(1);
    expect(asked()).toEqual({ from: new Date("2026-11-09T11:00:00Z"), to: new Date("2026-11-10T06:00:00Z") });
    expect(sent[0]).toMatchObject({ to: ADA.waId, buttons: ["sign up", "set it up for me"] });
    expect(sent[0]!.body).toMatch(/^Hi Ada, it's yarnOga\. Still thinking about a WhatsApp assistant/);
    expect(await sendDemoFollowUps(deps)).toBe(0);
  });

  it("tells someone part way through signing up where they stopped", async () => {
    const { deps, sent } = setup([ADA], { [ADA.waId]: signup({ step: "prices", businessName: "Ada's Cakes", draftCsv: "Product,Price (naira)\nCupcakes,600\n" }) });
    await sendDemoFollowUps(deps);
    expect(sent[0]!.buttons).toEqual([]);
    expect(sent[0]!.body).toMatch(/\*Ada's Cakes\*.*Reply \*YES\* to save it/s);
  });

  it("asks for the prices again, not YES, when the waiting list can't be saved", async () => {
    const { deps, sent } = setup([ADA], { [ADA.waId]: signup({ step: "prices", businessName: "Ada's Cakes", draftCsv: "Product,Price (naira)\nCupcakes,lots\n" }) });
    await sendDemoFollowUps(deps);
    expect(sent[0]!.body).toMatch(/Send your prices to finish/);
  });

  it("leaves out people who signed up, chats staff took over and the team's own number", async () => {
    const visitors = [ADA, { contactId: "c-bayo", waId: "2348022222222", name: null }, { contactId: "c-team", waId: "2340000000000", name: null }];
    const { deps, sent } = setup(visitors, { [ADA.waId]: signup({ step: "done", businessId: "biz-1" }) }, ["c-bayo"]);
    expect(await sendDemoFollowUps(deps)).toBe(0);
    expect(sent).toEqual([]);
  });

  it("waits for the morning", async () => {
    const { deps, sent } = setup([ADA]);
    expect(await sendDemoFollowUps({ ...deps, now: new Date("2026-11-10T21:30:00Z") })).toBe(0);
    expect(sent).toEqual([]);
  });
});

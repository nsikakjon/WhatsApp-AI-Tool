import { describe, expect, it } from "vitest";
import type { Notice } from "../../core/product.js";
import { planLapsed } from "./plan.js";
import { renewalStep, sendRenewalReminders, type RenewalBusiness, type RenewalStore } from "./renewals.js";

const END = new Date("2026-11-03T10:00:00Z");
const at = (iso: string) => new Date(iso);

describe("renewalStep", () => {
  it("goes from reminder to grace to Free", () => {
    expect(renewalStep(END, 3, at("2026-10-30T12:00:00Z"))).toBe(0);
    expect(renewalStep(END, 3, at("2026-10-31T12:00:00Z"))).toBe(1);
    expect(renewalStep(END, 3, at("2026-11-03T12:00:00Z"))).toBe(2);
    expect(renewalStep(END, 3, at("2026-11-05T12:00:00Z"))).toBe(3);
    expect(renewalStep(END, 3, at("2026-11-06T12:00:00Z"))).toBe(4);
    // Long gone (e.g. before the switch went on): left alone.
    expect(renewalStep(END, 3, at("2026-11-20T12:00:00Z"))).toBe(0);
    // No grace: straight to Free.
    expect(renewalStep(END, 0, at("2026-11-03T12:00:00Z"))).toBe(4);
  });
});

describe("planLapsed", () => {
  it("keeps a plan in its grace period", () => {
    const now = at("2026-11-04T12:00:00Z");
    expect(planLapsed({ plan_paid_until: END.toISOString() }, now)).toBe(true);
    expect(planLapsed({ plan_paid_until: END.toISOString(), plan_grace_until: "2026-11-06T10:00:00Z" }, now)).toBe(false);
    expect(planLapsed({ plan_paid_until: null }, now)).toBe(false);
  });
});

function setup(opts: { reachable?: boolean; business?: Partial<RenewalBusiness> } = {}) {
  const business: RenewalBusiness = {
    id: "b1",
    name: "Ada Cakes",
    planCode: "starter",
    planName: "Starter",
    paidUntil: END,
    graceUntil: null,
    noticeFor: null,
    noticeStep: 0,
    ...opts.business,
  };
  const graces: Date[] = [];
  const store: RenewalStore = {
    due: async () => [business],
    setGrace: async (_id, _until, grace) => {
      graces.push(grace);
      business.graceUntil = grace;
    },
    claim: async (_id, until, step) => {
      if (business.noticeFor?.getTime() === until.getTime() && business.noticeStep >= step) return false;
      business.noticeFor = until;
      business.noticeStep = step;
      return true;
    },
  };
  const sent: Notice[] = [];
  const alerts: string[] = [];
  const run = (iso: string) =>
    sendRenewalReminders({
      store,
      graceDays: 3,
      owner: async () => ({ waId: "2348011111111" }),
      canMessageFreely: async () => opts.reachable ?? true,
      send: async (note) => {
        sent.push(note);
      },
      alertYarnoga: async (text) => {
        alerts.push(text);
      },
      now: () => at(iso),
    });
  return { run, sent, alerts, graces };
}

describe("sendRenewalReminders", () => {
  it("reminds the owner once per step, with Renew buttons", async () => {
    const { run, sent, graces } = setup();
    await run("2026-10-31T10:00:00Z");
    await run("2026-10-31T11:00:00Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.buttons?.body).toBe("Your *Starter* plan ends on 3 November. Tap a button to renew it.");
    expect(sent[0]?.buttons?.buttons.map((b) => b.id)).toEqual(["upgrade starter", "upgrade starter yearly"]);
    expect(graces).toEqual([at("2026-11-06T10:00:00Z")]);

    await run("2026-11-03T12:00:00Z");
    expect(sent[1]?.buttons?.body).toContain("Everything keeps working until 6 November");
  });

  it("saves the grace period at night but waits for morning to message", async () => {
    const { run, sent, graces } = setup();
    await run("2026-11-02T23:00:00Z");
    expect(graces).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("tells yarnOga when the owner can't be reached, and when a plan drops to Free", async () => {
    const { run, sent, alerts } = setup({ reachable: false });
    await run("2026-10-31T10:00:00Z");
    expect(sent).toHaveLength(0);
    expect(alerts[0]).toContain("Couldn't remind Ada Cakes on WhatsApp");
    await run("2026-11-06T12:00:00Z");
    expect(alerts[1]).toBe("Ada Cakes didn't renew Starter (ended 3 November) and is now on Free. Owner: +2348011111111.");
  });

  it("starts again for a new end date once the owner renews", async () => {
    const { run, sent } = setup({ business: { noticeFor: at("2026-10-03T10:00:00Z"), noticeStep: 4 } });
    await run("2026-10-31T10:00:00Z");
    expect(sent).toHaveLength(1);
  });
});

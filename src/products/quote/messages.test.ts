import { describe, expect, it } from "vitest";
import type { PlanFeatures } from "./features.js";
import { createMessageAllowance, type SentStore } from "./messages.js";

const NOW = () => new Date("2026-10-16T12:00:00Z");

function features(limit: number | null): PlanFeatures {
  return { planCode: async () => "starter", has: async () => true, limit: async () => limit };
}

function store(sent: number, ownAccount = false) {
  const claimed = new Set<string>();
  const months: string[] = [];
  const s: SentStore & { sent_: number } = {
    sent_: sent,
    async sent(month) {
      months.push(month);
      return s.sent_;
    },
    async claimWarning(month, level) {
      const key = `${month}:${level}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    },
    ownAccount: async () => ownAccount,
  };
  return Object.assign(s, { months });
}

describe("bot messages", () => {
  it("warns the owner once at 80% and once when the allowance is used up", async () => {
    const sent = store(79);
    const allowance = createMessageAllowance({ features: features(100), store: sent, now: NOW });
    expect(await allowance.check()).toBeNull();
    sent.sent_ = 80;
    expect(await allowance.check()).toContain("sent 80 of the 100 bot messages");
    expect(sent.months[0]).toBe("2026-10-01");
    sent.sent_ = 95;
    expect(await allowance.check()).toBeNull();
    sent.sent_ = 100;
    expect(await allowance.check()).toContain("sent all 100 bot messages");
    sent.sent_ = 130;
    expect(await allowance.check()).toBeNull();
  });

  it("doesn't send a late 80% warning after the allowance is used up", async () => {
    const sent = store(120);
    const allowance = createMessageAllowance({ features: features(100), store: sent, now: NOW });
    expect(await allowance.check()).toContain("sent all 100");
    expect(await allowance.check()).toBeNull();
  });

  it("checks nothing when the plan has no allowance", async () => {
    const sent = store(5000);
    const allowance = createMessageAllowance({ features: features(null), store: sent, now: NOW });
    expect(await allowance.check()).toBeNull();
    expect(await allowance.summaryLine()).toBeNull();
    expect(sent.months).toHaveLength(0);
  });

  it("leaves numbers the business connected itself alone, since Meta bills the business", async () => {
    const allowance = createMessageAllowance({ features: features(100), store: store(500, true), now: NOW });
    expect(await allowance.check()).toBeNull();
    expect(await allowance.summaryLine()).toBeNull();
  });

  it("gives the owner's plan reply a line with this month's count", async () => {
    const allowance = createMessageAllowance({ features: features(1500), store: store(312), now: NOW });
    expect(await allowance.summaryLine()).toBe("Bot messages this month: 312 of 1500");
  });

  it("never stops the bot when the count can't be read", async () => {
    const broken: SentStore = {
      sent: async () => {
        throw new Error("no table");
      },
      claimWarning: async () => true,
      ownAccount: async () => false,
    };
    const allowance = createMessageAllowance({ features: features(100), store: broken, now: NOW, log: { error() {} } });
    expect(await allowance.check()).toBeNull();
    expect(await allowance.summaryLine()).toBeNull();
  });
});

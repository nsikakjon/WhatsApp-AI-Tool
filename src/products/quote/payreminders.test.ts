import { describe, expect, it, vi } from "vitest";
import { reminderDue, sendPayReminders, type PayReminderStore, type UnpaidOrder } from "./payreminders.js";

// 10am in Lagos (UTC+1).
const NOW = new Date("2026-10-26T09:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function store(orders: UnpaidOrder[]) {
  const claims: Array<[string, number]> = [];
  const s: PayReminderStore = {
    unpaid: async () => orders.filter((o) => o.reminders < 2),
    async claim(id, n) {
      const o = orders.find((x) => x.id === id);
      if (!o || o.reminders !== n - 1) return false;
      o.reminders = n;
      claims.push([id, n]);
      return true;
    },
  };
  return { s, claims };
}

const order = (id: string, confirmedHoursAgo: number, reminders = 0): UnpaidOrder => ({
  id, orderNumber: 1000 + Number(id), contactId: `c${id}`, customerWaId: `23480000000${id}`, confirmedAt: hoursAgo(confirmedHoursAgo), reminders,
});

describe("payment reminders", () => {
  it("is due at 3 hours, then at 20 hours, and never a third time", () => {
    expect(reminderDue({ confirmedAt: hoursAgo(2), reminders: 0 }, NOW)).toBeNull();
    expect(reminderDue({ confirmedAt: hoursAgo(3), reminders: 0 }, NOW)).toBe(1);
    expect(reminderDue({ confirmedAt: hoursAgo(10), reminders: 1 }, NOW)).toBeNull();
    expect(reminderDue({ confirmedAt: hoursAgo(20), reminders: 1 }, NOW)).toBe(2);
    expect(reminderDue({ confirmedAt: hoursAgo(21), reminders: 2 }, NOW)).toBeNull();
    // A first reminder missed overnight isn't sent on top of the second.
    expect(reminderDue({ confirmedAt: hoursAgo(21), reminders: 0 }, NOW)).toBeNull();
    // Old orders are left alone.
    expect(reminderDue({ confirmedAt: hoursAgo(30), reminders: 1 }, NOW)).toBeNull();
  });

  it("sends each due reminder once, skipping closed chats, paused chats and STOP", async () => {
    const orders = [order("1", 4), order("2", 21, 1), order("3", 4), order("4", 4), order("5", 4)];
    const { s, claims } = store(orders);
    const sent: string[] = [];
    const deps = {
      store: s,
      canMessageFreely: async (waId: string) => !waId.endsWith("3"),
      isPaused: async (contactId: string) => contactId === "c4",
      optedOut: async (contactId: string) => contactId === "c5",
      remind: vi.fn(async (n: number, k: 1 | 2) => `reminder ${k} for ${n}`),
      sendText: async (_to: string, text: string) => void sent.push(text),
      now: () => NOW,
    };
    expect(await sendPayReminders("b1", deps)).toEqual({ sent: 2, skipped: 3 });
    expect(sent).toEqual(["reminder 1 for 1001", "reminder 2 for 1002"]);
    expect(claims).toEqual([["1", 1], ["2", 2]]);
    // Run again straight away: nothing new is due.
    expect((await sendPayReminders("b1", deps)).sent).toBe(0);
  });

  it("stays quiet at night and when the order no longer needs a reminder", async () => {
    const { s } = store([order("1", 4)]);
    const sendText = vi.fn(async () => {});
    const base = { store: s, canMessageFreely: async () => true, isPaused: async () => false, sendText };
    await sendPayReminders("b1", { ...base, remind: async () => "x", now: () => new Date("2026-10-26T21:30:00Z") });
    await sendPayReminders("b1", { ...base, remind: async () => null, now: () => NOW });
    expect(sendText).not.toHaveBeenCalled();
  });
});

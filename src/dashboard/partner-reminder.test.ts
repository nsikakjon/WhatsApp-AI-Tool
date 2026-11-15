import { describe, expect, it } from "vitest";
import { clockText, reminderText, sendDueReminders, whenText, type DueReminder, type ReminderStore } from "./partner-reminder.js";

const TEDX: DueReminder = {
  leadId: 4,
  event: "TEDxUNIUYO",
  eventDate: "2026-11-28",
  eventTime: "09:00",
  address: "Main Auditorium, University of Uyo",
  businessId: "biz-1",
  phoneNumberId: "555",
};

function memory(due: DueReminder[], holders: string[]) {
  const claimed = new Set<number>();
  const done: Array<[number, number]> = [];
  const asked: string[] = [];
  const store: ReminderStore = {
    async due(date) {
      asked.push(date);
      return due.filter((d) => d.eventDate === date);
    },
    async claim(id) {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
    holders: async () => holders,
    async done(id, sent) {
      done.push([id, sent]);
    },
  };
  return { store, done, asked };
}

const quiet = { error() {}, info() {} };
// 27 Nov 2026, 11am in Lagos.
const DAY_BEFORE = () => new Date("2026-11-27T10:00:00Z");

describe("event reminder", () => {
  it("says when and where in plain words, with a map link", () => {
    expect(clockText("09:00")).toBe("9am");
    expect(clockText("18:30")).toBe("6:30pm");
    expect(clockText("12:00")).toBe("12pm");
    expect(clockText("00:15")).toBe("12:15am");
    expect(whenText("2026-11-28", "09:00")).toBe("Saturday 28 November at 9am");
    expect(whenText("2026-11-28", null)).toBe("Saturday 28 November");
    const text = reminderText(TEDX);
    expect(text).toContain("*TEDxUNIUYO* is tomorrow, Saturday 28 November at 9am.");
    expect(text).toContain("Where: Main Auditorium, University of Uyo");
    expect(text).toContain("https://www.google.com/maps/search/?api=1&query=Main%20Auditorium");
    expect(text).toContain("*my tickets*");
    expect(reminderText({ ...TEDX, address: null })).not.toContain("Where:");
  });

  it("sends once, the day before, as a message inside the day and a template outside it", async () => {
    const m = memory([TEDX], ["2348000000001", "2348000000002", "2348000000003"]);
    const texts: string[] = [];
    const templates: Array<[string, string[]]> = [];
    const deps = {
      store: m.store,
      canMessageFreely: async (waId: string) => waId.endsWith("1"),
      sendText: async (to: string) => void texts.push(to),
      sendTemplate: async (to: string, params: string[]) => void templates.push([to, params]),
      now: DAY_BEFORE,
      log: quiet,
    };
    expect(await sendDueReminders(deps)).toEqual({ sent: 3, skipped: 0, failed: 0 });
    expect(m.asked).toEqual(["2026-11-28"]);
    expect(texts).toEqual(["2348000000001"]);
    expect(templates).toEqual([
      ["2348000000002", ["TEDxUNIUYO", "Saturday 28 November at 9am", "Main Auditorium, University of Uyo"]],
      ["2348000000003", ["TEDxUNIUYO", "Saturday 28 November at 9am", "Main Auditorium, University of Uyo"]],
    ]);
    expect(m.done).toEqual([[4, 3]]);

    expect((await sendDueReminders(deps)).sent).toBe(0);
    expect(texts).toHaveLength(1);
  });

  it("without a template, only reaches people who messaged in the last day", async () => {
    const m = memory([TEDX], ["2348000000001", "2348000000002"]);
    const result = await sendDueReminders({
      store: m.store,
      canMessageFreely: async (waId) => waId.endsWith("1"),
      sendText: async () => {},
      now: DAY_BEFORE,
      log: quiet,
    });
    expect(result).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(m.done).toEqual([[4, 1]]);
  });

  it("waits for the daytime and keeps going when one send fails", async () => {
    const night = memory([TEDX], ["2348000000001"]);
    const atNight = await sendDueReminders({ store: night.store, canMessageFreely: async () => true, sendText: async () => {}, now: () => new Date("2026-11-27T03:00:00Z"), log: quiet });
    expect(atNight.sent).toBe(0);
    expect(night.asked).toEqual([]);

    const m = memory([TEDX], ["2348000000001", "2348000000002"]);
    const result = await sendDueReminders({
      store: m.store,
      canMessageFreely: async () => true,
      sendText: async (to) => {
        if (to.endsWith("1")) throw new Error("WhatsApp said no");
      },
      now: DAY_BEFORE,
      log: quiet,
    });
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 1 });
  });
});

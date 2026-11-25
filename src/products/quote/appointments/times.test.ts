import { describe, expect, it } from "vitest";
import { atLagos, lagos, readDay, readHours, readTime, readWeekdays, showWeekdays, showWhen } from "./times.js";

// Wednesday 25 Nov 2026, 10:00am in Lagos.
const NOW = new Date("2026-11-25T09:00:00Z");

describe("Lagos times", () => {
  it("turns a moment into the Lagos day and minute, and back", () => {
    expect(lagos(NOW)).toEqual({ day: "2026-11-25", weekday: 3, minute: 600 });
    expect(atLagos("2026-11-25", 600).toISOString()).toBe(NOW.toISOString());
    expect(showWhen(atLagos("2026-11-27", 9 * 60))).toBe("Fri 27 Nov, 9:00am");
    expect(showWhen(atLagos("2026-11-27", 13 * 60 + 30))).toBe("Fri 27 Nov, 1:30pm");
  });
});

describe("reading what owners type", () => {
  it("reads weekdays", () => {
    expect(readWeekdays("Mon-Fri")).toEqual([1, 2, 3, 4, 5]);
    expect(readWeekdays("Mon Wed Fri")).toEqual([1, 3, 5]);
    expect(readWeekdays("sat")).toEqual([6]);
    expect(readWeekdays("Fri-Mon")).toEqual([5, 6, 0, 1]);
    expect(readWeekdays("weekends")).toEqual([0, 6]);
    expect(readWeekdays("money")).toBeNull();
    expect(showWeekdays([1, 2, 3, 4, 5])).toBe("Mon-Fri");
    expect(showWeekdays([1, 3, 5])).toBe("Mon, Wed, Fri");
  });

  it("reads times and hours, with 9-5 meaning the afternoon", () => {
    expect(readTime("7am")).toBe(420);
    expect(readTime("12pm")).toBe(720);
    expect(readTime("17:30")).toBe(1050);
    expect(readTime("13pm")).toBeNull();
    expect(readHours("9-5")).toEqual({ start: 540, end: 1020 });
    expect(readHours("8:30am-6pm")).toEqual({ start: 510, end: 1080 });
    expect(readHours("1-3")).toEqual({ start: 780, end: 900 });
    expect(readHours("6-8")).toEqual({ start: 360, end: 480 });
    expect(readHours("5-5")).toBeNull();
  });

  it("reads a day from today on", () => {
    expect(readDay("today", NOW)).toBe("2026-11-25");
    expect(readDay("tomorrow", NOW)).toBe("2026-11-26");
    expect(readDay("Sat", NOW)).toBe("2026-11-28");
    expect(readDay("wednesday", NOW)).toBe("2026-11-25");
    expect(readDay("27 Nov", NOW)).toBe("2026-11-27");
    expect(readDay("3 Jan", NOW)).toBe("2027-01-03");
    expect(readDay("31/02", NOW)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { addDays, daysBetween, readHireDates, showDay } from "./dates.js";

// Wednesday 25 Nov 2026, 10am in Lagos.
const NOW = new Date("2026-11-25T09:00:00Z");
const read = (text: string) => readHireDates(text, NOW);

describe("readHireDates", () => {
  it("reads a start day and a length", () => {
    expect(read("Do you have a 20kVA generator for 3 days from Friday?")).toEqual({ start: "2026-11-27", back: "2026-11-30" });
    expect(read("tomorrow for a week")).toEqual({ start: "2026-11-26", back: "2026-12-03" });
    expect(read("2 weeks from 1 Dec")).toEqual({ start: "2026-12-01", back: "2026-12-15" });
    expect(read("I need it today for one day")).toEqual({ start: "2026-11-25", back: "2026-11-26" });
  });

  it("reads a range of dates", () => {
    expect(read("27 Nov to 30 Nov")).toEqual({ start: "2026-11-27", back: "2026-11-30" });
    expect(read("from the 27th to 30th November")).toEqual({ start: "2026-11-27", back: "2026-11-30" });
    expect(read("27/11 till 2/12")).toEqual({ start: "2026-11-27", back: "2026-12-02" });
    expect(read("Dec 30 to Jan 2")).toEqual({ start: "2026-12-30", back: "2027-01-02" });
    expect(read("friday to monday")).toEqual({ start: "2026-11-27", back: "2026-11-30" });
    expect(read("from 28 to 30 nov")).toEqual({ start: "2026-11-28", back: "2026-11-30" });
  });

  it("counts a same-day range as one day and reads the weekend", () => {
    expect(read("27 Nov to 27 Nov")).toEqual({ start: "2026-11-27", back: "2026-11-28" });
    expect(read("this weekend")).toEqual({ start: "2026-11-28", back: "2026-11-30" });
  });

  it("puts a date that has passed this year into next year", () => {
    expect(read("from 3 Jan for 2 days")).toEqual({ start: "2027-01-03", back: "2027-01-05" });
  });

  it("says what is missing", () => {
    expect(read("on Friday")).toEqual({ start: "2026-11-27", back: null });
    expect(read("for 3 days")).toEqual({ start: null, days: 3 });
  });

  it("leaves numbers that aren't dates alone", () => {
    expect(read("2 generators please")).toBeNull();
    expect(read("how much is the 20kva generator")).toBeNull();
    expect(read("I may need the marketing banner")).toBeNull();
    expect(read("what's the price per month")).toBeNull();
  });
});

describe("day helpers", () => {
  it("adds and counts days and shows them", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-11-27", "2026-11-30")).toBe(3);
    expect(showDay("2026-11-27")).toBe("Fri 27 Nov");
  });
});

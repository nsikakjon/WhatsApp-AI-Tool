import { describe, expect, it } from "vitest";
import { birthdaysCelebratedOn, daysUntil, formatMonthDay, lagosNow, parseBirthday } from "./dates.js";

describe("parseBirthday", () => {
  it.each([
    ["14 March", { month: 3, day: 14 }],
    ["14th of march 1990", { month: 3, day: 14 }],
    ["Ada Okafor, 3 Sept", { month: 9, day: 3 }],
    ["March 14th", { month: 3, day: 14 }],
    ["Dec 1", { month: 12, day: 1 }],
    ["14/03", { month: 3, day: 14 }],
    ["01-12-1988", { month: 12, day: 1 }],
    ["29 Feb", { month: 2, day: 29 }],
  ])("reads %s", (text, expected) => {
    expect(parseBirthday(text)).toEqual(expected);
  });

  it.each(["31 April", "32/01", "14/13", "Ada Okafor", "maybe 14"])("rejects %s", (text) => {
    expect(parseBirthday(text)).toBeNull();
  });
});

describe("dates", () => {
  it("formats a birthday", () => {
    expect(formatMonthDay({ month: 10, day: 14 })).toBe("14 October");
  });

  it("uses Lagos time (UTC+1)", () => {
    expect(lagosNow(new Date("2026-10-13T23:30:00Z"))).toEqual({ year: 2026, month: 10, day: 14, hour: 0 });
  });

  it("celebrates 29 February birthdays on 28 February in other years", () => {
    expect(birthdaysCelebratedOn(2027, 2, 28)).toEqual([{ month: 2, day: 28 }, { month: 2, day: 29 }]);
    expect(birthdaysCelebratedOn(2028, 2, 28)).toEqual([{ month: 2, day: 28 }]);
  });

  it("counts days to the next birthday", () => {
    const today = { year: 2026, month: 10, day: 10 };
    expect(daysUntil({ month: 10, day: 10 }, today)).toBe(0);
    expect(daysUntil({ month: 10, day: 14 }, today)).toBe(4);
    expect(daysUntil({ month: 10, day: 9 }, today)).toBe(364);
  });
});

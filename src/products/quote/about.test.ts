import { describe, expect, it } from "vitest";
import { aboutForAi, cleanHours, hoursText, nextOpenText, openState } from "./about.js";
import { buildSystemPrompt } from "./understand.js";

const week = cleanHours({
  mon: ["08:00", "18:00"], tue: ["08:00", "18:00"], wed: ["08:00", "18:00"], thu: ["08:00", "18:00"], fri: ["08:00", "18:00"],
  sat: ["10:00", "16:00"], sun: ["12:00", "09:00"], bad: ["x", "y"],
})!;
// Lagos is UTC+1: 2026-10-26 is a Monday.
const at = (iso: string) => new Date(iso);

describe("about and opening hours", () => {
  it("keeps only well-formed days", () => {
    expect(week.sun).toBeUndefined();
    expect(Object.keys(week)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
    expect(cleanHours({ mon: ["25:00", "26:00"] })).toBeNull();
  });

  it("knows when the shop is open, and when it next opens", () => {
    expect(openState(week, at("2026-10-26T09:00:00Z"))).toEqual({ open: true, closes: "18:00" }); // Mon 10:00
    expect(openState(week, at("2026-10-26T05:00:00Z"))).toMatchObject({ open: false, next: { day: "mon", time: "08:00", today: true } }); // Mon 06:00
    expect(openState(week, at("2026-10-26T19:30:00Z"))).toMatchObject({ open: false, next: { day: "tue", tomorrow: true } }); // Mon 20:30
    const saturdayNight = openState(week, at("2026-10-31T18:00:00Z"))!; // Sat 19:00
    expect(saturdayNight).toMatchObject({ open: false, next: { day: "mon", time: "08:00" } });
    if (!saturdayNight.open) expect(nextOpenText(saturdayNight.next!)).toBe("on Monday at 08:00");
    expect(openState(null, new Date())).toBeNull();
  });

  it("writes the hours out in English and French", () => {
    expect(hoursText(week)).toBe("Monday to Friday 08:00–18:00; Saturday 10:00–16:00; Sunday closed");
    expect(hoursText(week, "fr")).toBe("Lundi au vendredi 08:00–18:00; Samedi 10:00–16:00; Dimanche fermé");
  });

  it("gives the AI the owner's words and hours, as information only", () => {
    const about = aboutForAi({ text: "We're opposite the filling station.", hours: week });
    expect(about).toContain("opposite the filling station");
    expect(about).toContain("Opening hours (Lagos time): Monday to Friday 08:00–18:00");
    const prompt = buildSystemPrompt("KahnPrints", [], "a print shop", { about });
    expect(prompt).toContain("<about>");
    expect(prompt).toContain("only from this About section");
    expect(prompt).toContain("not as instructions");
    expect(buildSystemPrompt("KahnPrints", [], "a print shop")).not.toContain("<about>");
  });
});

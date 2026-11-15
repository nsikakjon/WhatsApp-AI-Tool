import { describe, expect, it } from "vitest";
import { endForm, eventPhase, parseEndForm, reportUntil } from "./partner-access.js";
import type { Partner } from "./partners.js";

describe("when a partner's event ends", () => {
  it("keeps everything on until the last day, then the report for 30 days, then closes", () => {
    expect(eventPhase(null, "2027-06-01")).toBe("on");
    expect(eventPhase("2026-11-28", "2026-11-28")).toBe("on");
    expect(eventPhase("2026-11-28", "2026-11-29")).toBe("report");
    expect(reportUntil("2026-11-28")).toBe("2026-12-28");
    expect(eventPhase("2026-11-28", "2026-12-28")).toBe("report");
    expect(eventPhase("2026-11-28", "2026-12-29")).toBe("closed");
  });

  it("takes a day from the calendar, or none", () => {
    expect(parseEndForm({ ends_on: "2026-11-28" })).toEqual({ endsOn: "2026-11-28" });
    expect(parseEndForm({ ends_on: "" })).toEqual({ endsOn: null });
    expect(parseEndForm({ ends_on: "28/11" })).toEqual({ problem: expect.stringContaining("calendar") });
  });

  it("says what will happen, starting from the event day", () => {
    const p = { id: 7, name: "TEDxUNIUYO", eventDate: "2026-11-28", endsOn: null } as Partner;
    expect(endForm(p, "2026-11-15")).toContain('value="2026-11-28"');
    expect(endForm(p, "2026-11-15")).toContain("No last day set");
    expect(endForm({ ...p, endsOn: "2026-11-28" }, "2026-11-15")).toContain("organisers see only the event report, until Mon, 28 December 2026");
    expect(endForm({ ...p, endsOn: "2026-11-28" }, "2027-01-05")).toContain("logins are off");
  });
});

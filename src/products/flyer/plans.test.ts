import { describe, expect, it } from "vitest";
import { allowsDesign, cheapestWith, planById } from "./plans.js";
import { THEMES } from "./themes.js";

describe("designs on each plan", () => {
  const cheapest = (id: string) => cheapestWith((p) => allowsDesign(p, id)).id;

  it("spreads the new styles across the plans", () => {
    expect(["minimal", "retro"].map(cheapest)).toEqual(["free", "free"]);
    expect(["swiss", "popart", "collage", "balloons"].map(cheapest)).toEqual(["standard", "standard", "standard", "standard"]);
    expect(["glass", "scribble", "y2k"].map(cheapest)).toEqual(["premium", "premium", "premium"]);
    expect(["editorial", "aurora"].map(cheapest)).toEqual(["deluxe", "deluxe"]);
  });

  it("gives Deluxe and Organisation every design", () => {
    for (const plan of ["deluxe", "organisation"]) expect(THEMES.every((t) => allowsDesign(planById(plan), t.id))).toBe(true);
    expect(planById("free").summary).toBe("up to 10 members, 4 designs, 1 admin");
  });
});

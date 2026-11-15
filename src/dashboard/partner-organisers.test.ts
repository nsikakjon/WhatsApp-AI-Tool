import { describe, expect, it } from "vitest";
import { can } from "../owner/roles.js";
import { parseShopForm } from "./partner-package.js";
import { parseOrganiserForm, renderOrganiserLink, renderOrganisers } from "./partner-organisers.js";
import type { Partner } from "./partners.js";

const TEDX = { id: 7, name: "TEDxUNIUYO", status: "Agreed" } as Partner;
const PLANS = [{ code: "free", name: "Free", monthlyPriceKobo: 0 }];

describe("organiser logins", () => {
  it("lets an organiser see chats, orders and ticket money, but not settings or payouts", () => {
    for (const p of ["inbox", "take_payment", "customers", "see_prices", "money"] as const) expect(can("organiser", p)).toBe(true);
    for (const p of ["edit_prices", "tools", "pay_out", "counter"] as const) expect(can("organiser", p)).toBe(false);
  });

  it("needs a name and a number", () => {
    expect(parseOrganiserForm({ name: " Ime Udo ", number: "0803 123 4567" })).toEqual({ name: "Ime Udo", waId: "2348031234567" });
    expect(parseOrganiserForm({ name: "", number: "08031234567" })).toEqual({ problem: expect.stringContaining("name") });
    expect(parseOrganiserForm({ name: "Ime", number: "12" })).toEqual({ problem: expect.stringContaining("number") });
  });

  it("lists the team and shows a new link once, ready to send", () => {
    const panel = renderOrganisers(TEDX, [{ name: "Ime Udo", waId: "2348031234567", role: "organiser", lastLoginAt: null }]);
    expect(panel).toContain('action="/dashboard/partners/7/organisers"');
    expect(panel).toContain("Ime Udo · +2348031234567");
    expect(renderOrganisers(TEDX, undefined)).toBe("");

    const page = renderOrganiserLink(TEDX, { name: "Ime", waId: "2348031234567" }, { url: "https://app.example/home/l/abc", owner: false }, "https://app.example/door/xyz");
    expect(page).toContain("https://wa.me/2348031234567?text=Hi%20Ime");
    expect(page).toContain("https://app.example/home/l/abc");
    expect(page).toContain("Door check-in screen");
    expect(page).toContain("as an event organiser");
  });

  it("takes a keyword for the quotes line, or leaves it alone before the migration", () => {
    expect(parseShopForm({ plan_code: "free", keyword: "TEDx UNIUYO" }, PLANS)).toMatchObject({ keyword: "tedxuniuyo" });
    expect(parseShopForm({ plan_code: "free", keyword: "" }, PLANS)).toMatchObject({ keyword: null });
    expect(parseShopForm({ plan_code: "free" }, PLANS)).toMatchObject({ keyword: undefined });
    expect(parseShopForm({ plan_code: "free", keyword: "x!" }, PLANS)).toEqual({ problem: expect.stringContaining("keyword") });
  });
});

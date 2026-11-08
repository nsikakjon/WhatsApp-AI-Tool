import { describe, expect, it } from "vitest";
import { readAlert, renderAlertEmail } from "./alert-card.js";

const signup =
  "New quote bot sign-up: Ada's Cakes (cakes and small chops), +2348031234567, 12 items, code JAY10. It's switched off until their new number is connected.";

describe("readAlert", () => {
  it("picks the business and key facts out of a sign-up alert", () => {
    expect(readAlert(signup)).toEqual({
      kind: "New quote bot sign-up",
      headline: "Ada's Cakes",
      facts: [
        ["Sells", "cakes and small chops"],
        ["WhatsApp", "+2348031234567"],
        ["Price list", "12 items"],
        ["Code", "JAY10"],
      ],
      waId: "2348031234567",
    });
  });

  it("reads a number-to-connect alert", () => {
    const card = readAlert("New number to connect for *Ada's Cakes*: 0803 123 4567.\nOwner's WhatsApp: +2348031234567");
    expect(card.kind).toBe("New number to connect");
    expect(card.headline).toBe("Ada's Cakes");
    expect(card.facts).toContainEqual(["New number", "0803 123 4567"]);
  });

  it("keeps any other alert whole", () => {
    expect(readAlert("Something odd happened with a long explanation that goes on").headline).toBe(
      "Something odd happened with a long explanation that goes on",
    );
  });
});

describe("renderAlertEmail", () => {
  it("has a short subject, a WhatsApp button and a plain-text copy", () => {
    const e = renderAlertEmail(signup, { imageBase: "https://x.test/email/img", now: new Date("2026-11-07T22:00:00Z") });
    expect(e.subject).toBe("yarnOga: New quote bot sign-up: Ada's Cakes");
    expect(e.html).toContain("https://wa.me/2348031234567");
    expect(e.html).toContain("Ada's Cakes");
    expect(e.text).toContain("Received: Sat 7 Nov, 11:00 pm");
  });

  it("adds the alert's own button, such as the steps for a number to connect", () => {
    const link = { label: "Open steps", url: "https://app.yarnoga.com/quote-setup/numbers/biz-1" };
    const e = renderAlertEmail("New number to connect for *Ada's Cakes*: 0803 123 4567.\nOwner's WhatsApp: +2348031234567", { link });
    expect(e.html).toContain(`href="${link.url}"`);
    expect(e.html).toContain("Open steps &rarr;");
    expect(e.text).toContain(`Open steps: ${link.url}`);
  });
});

import { describe, expect, it } from "vitest";
import { placeholderPortrait, renderBirthdayFlyer, renderDesignSheet, renderEventFlyer } from "./render.js";
import { findTheme, parseColour, THEMES } from "./themes.js";

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

describe("flyer drawing", () => {
  it("draws a birthday flyer in every design", async () => {
    const photo = await placeholderPortrait();
    for (const theme of THEMES) {
      const flyer = await renderBirthdayFlyer({
        photo,
        name: "Ada Okafor",
        dateLabel: "14 March",
        groupName: "Class of 2010",
        style: { theme, credit: "Made with Flyer Bot" },
      });
      expect(isJpeg(flyer)).toBe(true);
    }
  });

  it("draws an event flyer and a design sheet", async () => {
    const photo = await placeholderPortrait();
    expect(isJpeg(await renderEventFlyer({ photo, caption: "Homecoming" }))).toBe(true);
    const sheet = await renderDesignSheet({ photo, name: "Ada", dateLabel: "14 March", groupName: "G" }, THEMES.slice(0, 2).map((theme, i) => ({ theme, number: i + 1, note: i ? "Standard plan" : undefined })));
    expect(isJpeg(sheet)).toBe(true);
  });
});

describe("design choices", () => {
  it("finds designs by number, id or name", () => {
    expect(findTheme("2")?.id).toBe("emerald");
    expect(findTheme("Sunset")?.id).toBe("sunset");
    expect(findTheme("black and gold")?.id).toBe("midnight");
    expect(findTheme("0")).toBeUndefined();
  });

  it("reads colours", () => {
    expect(parseColour("Gold")).toBe("#f5c451");
    expect(parseColour("1A7F37")).toBe("#1a7f37");
    expect(parseColour("#12345")).toBeNull();
  });
});

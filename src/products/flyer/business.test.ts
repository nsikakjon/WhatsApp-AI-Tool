import { describe, expect, it } from "vitest";
import { BUSINESS_DESIGNS, comingYear, designMax, inSeason, HEADLINE_FONTS, inkOn, previewOf, renderBusinessFlyer, shrinkPhoto, type BusinessItem, type Frame } from "./business.js";
import { placeholderPortrait } from "./render.js";

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

describe("business flyers", () => {
  it("draws every design with one product, with many, and with no photos or prices", async () => {
    const photo = await placeholderPortrait();
    const full: BusinessItem[] = Array.from({ length: 8 }, (_, i) => ({ photo, name: `Product number ${i + 1} with a long name`, price: "₦1,250,000", from: i % 2 === 0 }));
    for (const design of BUSINESS_DESIGNS) {
      for (const items of [full.slice(0, 1), full, [{ name: "Home service" }], []]) {
        const flyer = await renderBusinessFlyer(design.id, {
          headline: "A headline that runs to forty characters",
          subline: "Order before Friday for free delivery anywhere in Lekki and Ajah",
          items,
          businessName: "Kemi's Cakes & Gifts",
          contact: { label: "Order on WhatsApp", number: "0704 897 1600" },
          link: "app.example.com/shop/kemis-cakes",
          fromWord: "from",
          accent: "#c6ff1f",
          credit: "Made with yarnOga",
          place: "Stand 14, Christmas Unplugged, Uyo",
          lang: "fr",
        });
        expect(isJpeg(flyer)).toBe(true);
      }
    }
  }, 60_000);

  it("draws every design with each headline font, size and photo setting from the console", async () => {
    const photo = await placeholderPortrait();
    for (const design of BUSINESS_DESIGNS) {
      for (const font of HEADLINE_FONTS) {
        const flyer = await renderBusinessFlyer(design.id, {
          headline: "Fresh bread every morning",
          items: [{ photo, name: "Agege bread", price: "₦1,500", pos: { zoom: 2, x: 0, y: 1 } }],
          businessName: "Mama Put",
          fromWord: "from",
          accent: "#e8541e",
          look: { font: font.id, size: 1.15 },
        });
        expect(isJpeg(flyer)).toBe(true);
      }
    }
  }, 60_000);

  it("offers the seasonal designs from November to mid-January, welcoming the right year", () => {
    expect(inSeason(new Date("2026-11-01T00:00:00Z"))).toBe(true);
    expect(inSeason(new Date("2027-01-15T12:00:00Z"))).toBe(true);
    expect(inSeason(new Date("2027-01-16T12:00:00Z"))).toBe(false);
    expect(inSeason(new Date("2026-07-01T00:00:00Z"))).toBe(false);
    expect(comingYear(new Date("2026-12-20T00:00:00Z"))).toBe(2027);
    expect(comingYear(new Date("2027-01-03T00:00:00Z"))).toBe(2027);
  });

  it("notes where each photo is drawn, so a finger on the flyer finds it", async () => {
    const photo = await placeholderPortrait();
    const items: BusinessItem[] = [{ photo, name: "Cake" }, { name: "No photo" }, { photo, name: "Gift box" }];
    for (const design of BUSINESS_DESIGNS) {
      const frames: Frame[] = [];
      await renderBusinessFlyer(design.id, { headline: "Hello", items, businessName: "Kemi", fromWord: "from", accent: "#e8541e", frames });
      const shown = Math.min(design.max, items.length);
      expect(frames.map((f) => f.item)).toEqual([0, 2].filter((i) => i < shown));
      for (const f of frames) {
        expect(f.box[0]).toBeLessThan(f.box[2]);
        expect(f.box[2]).toBeLessThanOrEqual(1080 + 40);
        expect(f.iw).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  it("has one-product designs and designs for a whole list", () => {
    expect(designMax("spotlight")).toBe(1);
    expect(designMax("menu")).toBe(8);
  });

  it("picks dark words on a light colour and white on a dark one", () => {
    expect(inkOn("#c6ff1f")).toBe("#111111");
    expect(inkOn("#7c3aed")).toBe("#ffffff");
  });

  it("shrinks the owner's photo and makes a small preview", async () => {
    expect(isJpeg(await shrinkPhoto(await placeholderPortrait()))).toBe(true);
    const flyer = await renderBusinessFlyer("grid", { headline: "New in", items: [{ name: "Mug" }], businessName: "Kahn", fromWord: "from", accent: "#128c4a" });
    const small = await previewOf(flyer);
    expect(isJpeg(small)).toBe(true);
    expect(small.length).toBeLessThan(flyer.length);
  });
});

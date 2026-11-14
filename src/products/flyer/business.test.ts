import { describe, expect, it } from "vitest";
import { BUSINESS_DESIGNS, designMax, HEADLINE_FONTS, inkOn, previewOf, renderBusinessFlyer, shrinkPhoto, type BusinessItem } from "./business.js";
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
          items: [{ photo, name: "Agege bread", price: "₦1,500" }],
          businessName: "Mama Put",
          fromWord: "from",
          accent: "#e8541e",
          look: { font: font.id, size: 1.15, zoom: 2, photoX: 0, photoY: 1 },
        });
        expect(isJpeg(flyer)).toBe(true);
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

import { describe, expect, it } from "vitest";
import { createKeywordUnderstander } from "./fallback.js";

const catalog = [
  { id: "flyer", name: "Flyers: A5, price per flyer", minQuantity: 10 },
  { id: "card", name: "Business cards: pack of 50, matte laminated", minQuantity: 1 },
  { id: "pouch-big", name: "Printed pouches: 14 x 20cm, pack of 100", minQuantity: 1 },
  { id: "pouch-small", name: "Printed pouches: 9 x 13cm resealable, pack of 100", minQuantity: 1 },
  { id: "tote", name: "Tote bags", minQuantity: 1 },
];
const read = (text: string) => createKeywordUnderstander().understand({ text, history: [], catalog });

describe("keyword understander", () => {
  it("reads yes and no", async () => {
    expect((await read("Yes please")).intent).toBe("confirm");
    expect((await read("ok")).intent).toBe("confirm");
    expect((await read("cancel it")).intent).toBe("cancel");
  });

  it("reads a request for the catalogue, keeping the menu for when there are no cards", async () => {
    const asked = await read("Can I see your catalogue?");
    expect(asked.intent).toBe("catalogue");
    expect(asked.message).toContain("1. Flyers: A5");
  });

  it("reads menu picks, one per line", async () => {
    expect(await read("1 x 200\n5*3")).toEqual({
      intent: "quote",
      items: [
        { variantId: "flyer", quantity: 200 },
        { variantId: "tote", quantity: 3 },
      ],
      message: null,
    });
    expect((await read("item 2: 4")).items).toEqual([{ variantId: "card", quantity: 4 }]);
  });

  it("matches plain requests that point at one item", async () => {
    expect((await read("I need 50 tote bags")).items).toEqual([{ variantId: "tote", quantity: 50 }]);
    expect((await read("300 flyers and 2 business card")).items).toEqual([
      { variantId: "flyer", quantity: 300 },
      { variantId: "card", quantity: 2 },
    ]);
  });

  it("shows the numbered menu when it can't tell", async () => {
    const pouches = await read("5 pouches");
    expect(pouches.intent).toBe("other");
    expect(pouches.message).toContain("3. Printed pouches: 14 x 20cm, pack of 100");
    expect((await read("good morning")).message).toContain("*1 x 100*");
    expect((await read("9 x 2")).intent).toBe("other");
  });
});

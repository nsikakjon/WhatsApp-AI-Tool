import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../core/sheets.js";
import { amountsInText, buildDraftPrompt, createClaudeDrafter, draftToCsv } from "./drafter.js";
import { readPriceList } from "./pricelist.js";

function fakeClient(parsed: unknown, stop_reason = "end_turn") {
  const calls: any[] = [];
  const client = {
    messages: {
      parse: async (req: unknown) => {
        calls.push(req);
        return { parsed_output: parsed, stop_reason };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("price list drafter", () => {
  it("sends the photos and text and maps the answer", async () => {
    const { client, calls } = fakeClient({
      rows: [{ product: "Flyers", option: "A5", minimum_order: 50, from_quantity: 50, price_naira: "120" }],
      notes: null,
    });
    const drafter = createClaudeDrafter({ apiKey: "x", model: "claude-haiku-5-5", client });
    const draft = await drafter.draft({
      businessName: "Ada Prints",
      description: "a print shop",
      text: "A5 flyers 120 each from 50",
      images: [{ mediaType: "image/png", data: "AAAA" }],
    });
    expect(draft).toEqual({ rows: [{ product: "Flyers", option: "A5", minQuantity: 50, fromQuantity: 50, price: "120" }], notes: null });
    const req = calls[0];
    expect(req.model).toBe("claude-haiku-5-5");
    expect(req.system).toContain("Ada Prints, a print shop,");
    expect(req.messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
    expect(req.messages[0].content[1].text).toContain("A5 flyers 120 each from 50");
  });

  it("fails loudly when the AI refuses", async () => {
    const { client } = fakeClient(null, "refusal");
    const drafter = createClaudeDrafter({ apiKey: "x", model: "m", client });
    await expect(drafter.draft({ businessName: "X", description: null, text: "hi", images: [] })).rejects.toThrow(/refusal/);
  });

  it("tells the AI never to make up a price", () => {
    expect(buildDraftPrompt("X", null)).toContain("Never guess, estimate or suggest a price");
  });
});

describe("amountsInText", () => {
  it("finds naira amounts in the ways people write them", () => {
    const found = amountsInText("Cupcakes N600, box ₦3,500. Cakes from 25k, small 2.5k, banner 1500.50");
    for (const naira of [600, 3500, 25000, 2500]) expect(found.has(naira * 100)).toBe(true);
    expect(found.has(150050)).toBe(true);
  });
});

describe("draftToCsv", () => {
  const draft = {
    rows: [
      { product: "Flyers", option: "A5, glossy", minQuantity: 50, fromQuantity: 50, price: "₦120" },
      { product: "Flyers", option: "A5, glossy", minQuantity: 50, fromQuantity: 500, price: "90" },
      { product: "Banners", option: "Standard", minQuantity: 0, fromQuantity: null, price: null },
      { product: "  ", option: "x", minQuantity: null, fromQuantity: null, price: "5" },
    ],
    notes: null,
  };

  it("writes rows the normal price list reader accepts", () => {
    const { csv, droppedPrices } = draftToCsv(draft, null);
    expect(droppedPrices).toBe(0);
    const { items, problems } = readPriceList(parseCsv(csv));
    expect(problems).toEqual([]);
    expect(items).toEqual([
      { product: "Flyers", option: "A5, glossy", minQuantity: 50, tiers: [{ minQuantity: 50, unitPriceKobo: 12_000 }, { minQuantity: 500, unitPriceKobo: 9_000 }] },
      { product: "Banners", option: "Standard", minQuantity: 1, tiers: [] },
    ]);
  });

  it("blanks prices that aren't in the owner's text", () => {
    const { csv, droppedPrices } = draftToCsv(draft, "Flyers A5 glossy 120 each from 50 copies");
    expect(droppedPrices).toBe(1);
    expect(csv).toContain('Flyers,"A5, glossy",50,500,\n');
  });
});

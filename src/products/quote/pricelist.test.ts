import { describe, expect, it } from "vitest";
import { parseCsv } from "../../core/sheets.js";
import { nairaToKobo, priceListCsv, productSlug, readPriceList } from "./pricelist.js";

describe("nairaToKobo", () => {
  it("reads plain naira amounts exactly", () => {
    expect(nairaToKobo("1500")).toBe(150_000);
    expect(nairaToKobo("₦1,500")).toBe(150_000);
    expect(nairaToKobo("N 1,500.5")).toBe(150_050);
    expect(nairaToKobo("0.07")).toBe(7);
    expect(nairaToKobo("19.99")).toBe(1_999);
  });

  it("refuses anything that isn't a plain amount", () => {
    for (const bad of ["15k", "1.234", "-5", "abc", "1,5,0.0.0", ""]) expect(nairaToKobo(bad)).toBeNull();
  });
});

describe("readPriceList", () => {
  it("groups rows into items with price tiers, in kobo", () => {
    const csv = `Product,Option,Minimum order,From quantity,Price (naira)
Branded T-shirts,"white, 1 colour",10,10,"5,000"
Branded T-shirts,"white, 1 colour",10,50,4200
Mugs,,6,,3500
Custom cakes,any size,,,`;
    const { items, problems } = readPriceList(parseCsv(csv));
    expect(problems).toEqual([]);
    expect(items).toEqual([
      {
        product: "Branded T-shirts",
        option: "white, 1 colour",
        minQuantity: 10,
        tiers: [
          { minQuantity: 10, unitPriceKobo: 500_000 },
          { minQuantity: 50, unitPriceKobo: 420_000 },
        ],
      },
      { product: "Mugs", option: "Standard", minQuantity: 6, tiers: [{ minQuantity: 6, unitPriceKobo: 350_000 }] },
      { product: "Custom cakes", option: "any size", minQuantity: 1, tiers: [] },
    ]);
  });

  it("finds columns by their headings, in any order", () => {
    const { items, problems } = readPriceList(parseCsv("Price,Item\n200,Flyers"));
    expect(problems).toEqual([]);
    expect(items).toEqual([{ product: "Flyers", option: "Standard", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 20_000 }] }]);
  });

  it("reports every problem with its row number", () => {
    const csv = `Product,Option,Min,From,Price
Mugs,,6,6,3000
Mugs,,4,10,3000
Mugs,big,1,1,100
Mugs,big,1,1,90
Cakes,,1,,
Cakes,,1,5,100
,,1,1,100
Pens,,two,,100
Pens,,1,,15k`;
    const { problems } = readPriceList(parseCsv(csv));
    expect(problems.map((p) => p.line)).toEqual([3, 5, 7, 8, 9, 10]);
    expect(problems[0]!.message).toContain("minimum order 6 in row 2");
    expect(problems[5]!.message).toContain("isn't a price");
  });

  it("needs headings with at least Product and Price", () => {
    expect(readPriceList(parseCsv("Flyers,200")).problems[0]!.message).toContain("empty");
    expect(readPriceList(parseCsv("Flyers,200\nCards,300")).problems[0]!.message).toContain("headings");
  });

  it("writes a list back out that reads in the same", () => {
    const { items } = readPriceList(parseCsv(`Product,Option,Min,From,Price\nT-shirts,"white, ""plain""",10,10,5000.5\nCakes,,1,,`));
    const again = readPriceList(parseCsv(priceListCsv(items)));
    expect(again.problems).toEqual([]);
    expect(again.items).toEqual(items);
  });
});

describe("productSlug", () => {
  it("makes a short fixed name", () => {
    expect(productSlug("Branded T-shirts (XL)")).toBe("branded-t-shirts-xl");
    expect(productSlug("₦₦")).toBe("item");
  });
});

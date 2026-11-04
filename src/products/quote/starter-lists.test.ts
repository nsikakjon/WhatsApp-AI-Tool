import { describe, expect, it } from "vitest";
import { parseCsv } from "../../core/sheets.js";
import { readPriceList } from "./pricelist.js";
import { starterList } from "./starter-lists.js";

describe("starter price lists", () => {
  it("picks a list from the business name or what it sells", () => {
    expect(starterList("Barber business", null)?.trade).toBe("a barber");
    expect(starterList("Prynzo", "I cut hair")?.trade).toBe("a barber");
    expect(starterList("Tolu's Place", "knotless braids and wigs")?.trade).toBe("a hair salon");
    expect(starterList("Mama Cakes", "cakes and pastries")?.trade).toBe("a cake and pastry business");
    expect(starterList("Iya Basira", "local food and soups")?.trade).toBe("a food business");
  });

  it("offers none when nothing fits", () => {
    expect(starterList("Ade Stores", "foodstuff and provisions")).toBeNull();
    expect(starterList("Gadget Hub", "phones and accessories")).toBeNull();
    expect(starterList("Grace Pharmacy", "medicines")).toBeNull();
  });

  it("writes every list so it reads without problems", () => {
    const samples = [
      "barber", "salon", "nails", "makeup", "tailor", "small chops", "cakes", "zobo", "restaurant",
      "printing", "laundry", "car wash", "phone repair", "photography", "event decor", "cleaning",
    ];
    for (const s of samples) {
      const list = starterList(null, s);
      expect(list, s).not.toBeNull();
      const { items, problems } = readPriceList(parseCsv(list!.csv));
      expect(problems, s).toEqual([]);
      expect(items.length, s).toBeGreaterThanOrEqual(4);
      expect(items.every((i) => i.tiers.length > 0), s).toBe(true);
    }
    expect(new Set(samples.map((s) => starterList(null, s)!.trade)).size).toBe(samples.length);
  });
});

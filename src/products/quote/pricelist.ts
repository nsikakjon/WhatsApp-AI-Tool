import { formatNaira } from "../../core/money.js";
import type { PriceTier } from "./pricing.js";

// A business's price list as the owner types or uploads it on the setup
// screen: one row per price, read from CSV (a file, pasted text or a Google
// Sheet). Prices are typed in naira and turned into whole kobo here, with
// string arithmetic so no rounding can creep in.
//
//   Product,         Option,          Minimum order, From quantity, Price
//   Branded T-shirts,"white, 1 colour", 10,          10,            5000
//   Branded T-shirts,"white, 1 colour", 10,          50,            4200
//   Custom cakes,    any size,        1,             ,              (blank: priced by the team)

export interface PriceListItem {
  product: string;
  /** e.g. "white, one-colour print". "Standard" when the row gives none. */
  option: string;
  /** Smallest quantity accepted for an order. */
  minQuantity: number;
  /** Price per piece from each quantity up. Empty means the team prices it case by case. */
  tiers: PriceTier[];
}

export interface PriceListProblem {
  /** Row number as the owner sees it in their spreadsheet (headings are row 1). */
  line: number;
  message: string;
}

export const MAX_PRICE_ROWS = 2000;
const DEFAULT_OPTION = "Standard";

type Column = "product" | "option" | "min" | "from" | "price";

function columnFor(heading: string): Column | null {
  const h = heading.toLowerCase();
  if (/price|naira|₦|amount|cost|rate/.test(h)) return "price";
  if (/^from|from qty|from quantity|tier|break|quantity from/.test(h)) return "from";
  if (/min|moq/.test(h)) return "min";
  if (/option|variant|size|type|spec|detail|description/.test(h)) return "option";
  if (/product|item|name|service|category/.test(h)) return "product";
  return null;
}

/**
 * "₦1,500", "N1500", "1500.50" -> kobo. Returns null for anything that isn't a
 * plain amount (including "15k", so a typo never becomes a price).
 */
export function nairaToKobo(text: string): number | null {
  const clean = text.replace(/^\s*(₦|ngn|n)\s*/i, "").replace(/[,\s]/g, "");
  const m = clean.match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

function wholeNumber(text: string): number | null {
  const clean = text.replace(/[,\s]/g, "");
  if (!/^\d{1,9}$/.test(clean)) return null;
  const n = Number(clean);
  return n >= 1 ? n : null;
}

/**
 * Reads a table (first row = headings) into a price list. Every problem is
 * reported with its row number; the list is only usable when there are none.
 */
export function readPriceList(table: string[][]): { items: PriceListItem[]; problems: PriceListProblem[] } {
  const problems: PriceListProblem[] = [];
  if (table.length < 2) {
    return { items: [], problems: [{ line: 1, message: "The list is empty. Put headings in row 1 and one price per row below." }] };
  }
  if (table.length - 1 > MAX_PRICE_ROWS) {
    return { items: [], problems: [{ line: 1, message: `The list has more than ${MAX_PRICE_ROWS} rows. Please split it up.` }] };
  }

  const headings = table[0]!.map(columnFor);
  const at = (col: Column) => headings.indexOf(col);
  if (at("product") < 0 || at("price") < 0) {
    return {
      items: [],
      problems: [{ line: 1, message: "Row 1 needs headings, at least Product and Price (also Option, Minimum order and From quantity if you use them)." }],
    };
  }

  const items = new Map<string, PriceListItem & { line: number; blankPrice: boolean }>();
  table.slice(1).forEach((row, i) => {
    const line = i + 2;
    const cell = (col: Column) => (at(col) >= 0 ? (row[at(col)] ?? "").replace(/\s+/g, " ").trim() : "");

    const product = cell("product");
    if (!product) {
      if (row.some((c) => c.trim())) problems.push({ line, message: "No product name." });
      return;
    }
    if (product.length > 80) return void problems.push({ line, message: "The product name is too long (80 letters at most)." });
    const option = cell("option") || DEFAULT_OPTION;
    if (option.length > 120) return void problems.push({ line, message: "The option is too long (120 letters at most)." });

    const minText = cell("min");
    const minQuantity = minText ? wholeNumber(minText) : 1;
    if (minQuantity === null) return void problems.push({ line, message: `"${minText}" isn't a whole number for the minimum order.` });

    const fromText = cell("from");
    const from = fromText ? wholeNumber(fromText) : minQuantity;
    if (from === null) return void problems.push({ line, message: `"${fromText}" isn't a whole number for "from quantity".` });

    const priceText = cell("price");
    const price = priceText ? nairaToKobo(priceText) : null;
    if (priceText && price === null) {
      return void problems.push({ line, message: `"${priceText}" isn't a price. Write it in naira, e.g. 1500 or 1,500.50.` });
    }

    const key = `${product.toLowerCase()}\u0000${option.toLowerCase()}`;
    let item = items.get(key);
    if (!item) {
      item = { product, option, minQuantity, tiers: [], line, blankPrice: false };
      items.set(key, item);
    } else if (item.minQuantity !== minQuantity) {
      return void problems.push({
        line,
        message: `${product} (${option}) has minimum order ${item.minQuantity} in row ${item.line} but ${minQuantity} here.`,
      });
    }

    if (price === null) {
      if (item.tiers.length) return void problems.push({ line, message: `${product} (${option}) has prices in other rows, so this one needs a price too.` });
      item.blankPrice = true;
      return;
    }
    if (item.blankPrice) return void problems.push({ line, message: `${product} (${option}) has a row with no price, so it can't have prices too.` });
    if (item.tiers.some((t) => t.minQuantity === from)) {
      return void problems.push({ line, message: `${product} (${option}) already has a price from ${from} pieces.` });
    }
    item.tiers.push({ minQuantity: from, unitPriceKobo: price });
  });

  return {
    items: [...items.values()].map(({ line: _line, blankPrice: _blank, ...item }) => ({
      ...item,
      tiers: item.tiers.sort((a, b) => a.minQuantity - b.minQuantity),
    })),
    problems,
  };
}

/** The short fixed name a product is saved under, e.g. "Branded T-shirts" -> "branded-t-shirts". */
export function productSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

/** Writes a price list back out as CSV in the upload format, so owners can download, edit and re-upload. */
export function priceListCsv(items: PriceListItem[]): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const naira = (kobo: number) => formatNaira(kobo).replace(/[₦,]/g, "");
  const rows = [["Product", "Option", "Minimum order", "From quantity", "Price (naira)"]];
  for (const item of items) {
    if (!item.tiers.length) rows.push([item.product, item.option, String(item.minQuantity), "", ""]);
    for (const t of item.tiers) rows.push([item.product, item.option, String(item.minQuantity), String(t.minQuantity), naira(t.unitPriceKobo)]);
  }
  return rows.map((r) => r.map(quote).join(",")).join("\n") + "\n";
}

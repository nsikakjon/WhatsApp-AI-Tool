import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { nairaToKobo } from "./pricelist.js";

// "Describe your business, AI drafts the price list." On the owner setup
// screen the owner types what they sell, or sends photos of their price list,
// and the AI writes it out as price-list rows. The rows only fill the
// "type it here" box: the owner checks and edits them, then the normal
// Check -> Save steps read and save them. The AI never saves anything, and a
// price it drafts only reaches customers after the owner has seen it and
// pressed Save, so prices still come from our database, set by the owner.

export const MAX_DRAFT_IMAGES = 3;
/** Per photo. Claude takes up to 5 MB once encoded; 3.5 MB keeps us under it. */
export const MAX_DRAFT_IMAGE_BYTES = 3.5 * 1024 * 1024;
export const MAX_DRAFT_TEXT = 4000;
export const MAX_DRAFT_ROWS = 300;
export const DRAFT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type DraftImageType = (typeof DRAFT_IMAGE_TYPES)[number];

export interface DraftImage {
  mediaType: DraftImageType;
  /** The photo, base64 encoded. */
  data: string;
}

export interface DraftRow {
  product: string;
  option: string;
  minQuantity: number | null;
  fromQuantity: number | null;
  /** In naira, as written on the owner's list, e.g. "1500". Null when the list gives no price. */
  price: string | null;
}

export interface PriceListDraft {
  rows: DraftRow[];
  /** Anything the owner should check, in plain English. */
  notes: string | null;
}

export interface PriceListDrafter {
  draft(input: { businessName: string; description: string | null; text: string; images: DraftImage[] }): Promise<PriceListDraft>;
}

const OutputSchema = z.object({
  rows: z.array(
    z.object({
      product: z.string(),
      option: z.string(),
      minimum_order: z.number().int().nullable(),
      from_quantity: z.number().int().nullable(),
      price_naira: z.string().nullable(),
    }),
  ),
  notes: z.string().nullable(),
});

export function buildDraftPrompt(businessName: string, description: string | null): string {
  return `You help ${businessName}${description ? `, ${description},` : ""} a business in Nigeria, set up a WhatsApp quote bot. The owner has described what they sell, or sent photos of their price list. Write it out as price-list rows for the owner to check.

Each row is one price:
- product: the item, e.g. "Branded T-shirts". Keep the owner's wording, tidied up.
- option: the size, type or variant, e.g. "white, one-colour print" or "A5". Use "Standard" when there is only one kind.
- minimum_order: the smallest quantity they accept for this product and option, if the list says so; otherwise null. Use the same value on every row of the same product and option.
- from_quantity: for bulk prices, the quantity this price starts at (e.g. 50 for "50 and above"); otherwise null.
- price_naira: the price for ONE piece, in naira, digits only with an optional decimal point (e.g. "1500" or "1500.50"). Write "15k" as "15000". If the list gives a price for a pack or a batch (e.g. "100 for 5,000"), make the product or option say the pack ("pack of 100") and use the pack price.

The most important rule: only copy prices the owner actually wrote or that are in the photo. Never guess, estimate or suggest a price. When an item has no price (for example "price on request" or "call us"), still list it with price_naira null, so the team prices it by hand.

Skip anything that isn't something they sell (phone numbers, addresses, bank details, slogans). Keep at most ${MAX_DRAFT_ROWS} rows.

In notes, tell the owner in one or two short, plain sentences anything they should check: words you couldn't read, prices that looked unclear, or items you left without a price. Use null when there's nothing to flag.`;
}

export function createClaudeDrafter(opts: { apiKey: string; model: string; client?: Anthropic }): PriceListDrafter {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  return {
    async draft({ businessName, description, text, images }) {
      const content: Anthropic.ContentBlockParam[] = images.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data },
      }));
      content.push({
        type: "text",
        text: text.trim()
          ? `What the owner wrote:\n<owner_text>\n${text.trim()}\n</owner_text>`
          : "Read the price list in the photo(s).",
      });
      const response = await client.messages.parse({
        model: opts.model,
        max_tokens: 16000,
        system: buildDraftPrompt(businessName, description),
        messages: [{ role: "user", content }],
        output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
      });
      const parsed = response.parsed_output;
      if (response.stop_reason === "refusal" || !parsed) {
        throw new Error(`AI could not draft the price list (stop_reason: ${response.stop_reason})`);
      }
      return {
        rows: parsed.rows.slice(0, MAX_DRAFT_ROWS).map((r) => ({
          product: r.product,
          option: r.option,
          minQuantity: r.minimum_order,
          fromQuantity: r.from_quantity,
          price: r.price_naira,
        })),
        notes: parsed.notes,
      };
    },
  };
}

/**
 * Every amount of money written in the owner's text, in kobo ("5,000",
 * "₦1500", "15k", "2.5k"). Used to drop any drafted price the owner never
 * typed, so the AI can't slip in a price of its own.
 */
export function amountsInText(text: string): Set<number> {
  const amounts = new Set<number>();
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi)) {
    const digits = m[1]!.replace(/,/g, "");
    if (m[2]) {
      // "2.5k" -> 2500 naira, done in whole numbers.
      const [whole, frac = ""] = digits.split(".");
      if (frac.length > 3) continue;
      amounts.add((Number(whole) * 1000 + Number(frac.padEnd(3, "0"))) * 100);
    } else {
      const kobo = nairaToKobo(digits);
      if (kobo !== null) amounts.add(kobo);
    }
  }
  return amounts;
}

/**
 * Turns the AI's draft into rows for the "type it here" box (the same CSV the
 * normal upload reads). When the owner only typed text, any price that isn't
 * in their text is left blank and counted, so they can fill it in.
 */
export function draftToCsv(draft: PriceListDraft, ownerText: string | null): { csv: string; droppedPrices: number } {
  const known = ownerText === null ? null : amountsInText(ownerText);
  let droppedPrices = 0;
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const clean = (v: string) => v.replace(/\s+/g, " ").trim();
  const rows = [["Product", "Option", "Minimum order", "From quantity", "Price (naira)"]];
  for (const r of draft.rows) {
    const product = clean(r.product);
    if (!product) continue;
    let price = r.price ? clean(r.price).replace(/^(₦|ngn|n)\s*/i, "") : "";
    if (price && known) {
      const kobo = nairaToKobo(price);
      if (kobo === null || !known.has(kobo)) {
        price = "";
        droppedPrices++;
      }
    }
    const whole = (n: number | null) => (n !== null && Number.isInteger(n) && n >= 1 ? String(n) : "");
    rows.push([product, clean(r.option), whole(r.minQuantity), whole(r.fromQuantity), price]);
  }
  return { csv: rows.map((r) => r.map(quote).join(",")).join("\n") + "\n", droppedPrices };
}

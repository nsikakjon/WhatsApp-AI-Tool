import type { Variant } from "./pricing.js";

// "Buy now" on the shop page. The order the page types for the customer ends
// with a code naming each option and how many:
//
//   Hello Ada's Prints, I'd like to buy now:
//   • 100 x Flyers: A5
//   • 6 x Mugs: White
//
//   Order code: SHOP 1a2b3c4d*100 5e6f7a8b*6
//
// Each part is the start of the option's id and the quantity, so the bot
// prices and confirms the order in code straight away (no AI, no "reply
// YES") and sends back the total, delivery and pay link. Prices still come
// from the database at that moment, never from the message.

const REF = 8;
const CODE = /(?:order code|code commande)\s*:?\s*SHOP((?:\s+[0-9a-f]{8}\*\d{1,6})+)\s*$/i;

/** The short id the code uses for an option. */
export const buyRef = (variantId: string) => variantId.replace(/-/g, "").slice(0, REF).toLowerCase();

/** The items in a "Buy now" message, matched to today's price list; null when it has no code. Unknown options are left out. */
export function buyNowItems(text: string, variants: Variant[]): Array<{ variantId: string; quantity: number }> | null {
  const m = text.trim().match(CODE);
  if (!m) return null;
  const byRef = new Map(variants.map((v) => [buyRef(v.id), v.id]));
  const items = new Map<string, number>();
  for (const part of m[1]!.trim().split(/\s+/)) {
    const [ref, qty] = part.split("*");
    const id = byRef.get(ref!.toLowerCase());
    const quantity = Number(qty);
    if (id && Number.isSafeInteger(quantity) && quantity > 0) items.set(id, (items.get(id) ?? 0) + quantity);
  }
  return [...items].map(([variantId, quantity]) => ({ variantId, quantity }));
}

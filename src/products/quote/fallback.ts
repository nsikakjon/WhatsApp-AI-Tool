import type { CatalogEntry, Understander, Understanding } from "./understand.js";

// The no-AI way of reading a customer's message, used when a business has
// used up its AI credits for the month (see credits.ts). It understands:
// - YES / OK / confirm, and NO / cancel,
// - an item number from the menu and how many, e.g. "3 x 100" (one per line),
// - a plain request whose words point at exactly one item, e.g. "50 tote bags",
// - asking for the catalogue, menu or price list.
// Anything else gets the numbered menu. Prices are still worked out in code
// from the database, exactly as with the AI.

const CONFIRM = /^(yes|yeah|yep|yup|ok|okay|confirm|confirmed|go ahead|sure|proceed)\b/i;
const CANCEL = /^(no|nope|cancel|stop|not now)\b/i;
const CATALOGUE = /\b(catalog(ue)?|menu|price ?list|products|what do you (sell|have))\b/i;
// "3 x 100", "3*100", "item 3: 100", "#3 - 100"
const MENU_PICK = /^(?:item|no\.?|number|#)?\s*(\d{1,3})\s*(?:x|\*|:|-|=|,|for)\s*(\d{1,7})\s*(?:pcs|pieces|copies|units|packs?)?\.?$/i;

/** Up to this many items are listed in the menu; WhatsApp messages get hard to read past that. */
const MENU_SIZE = 40;

export function createKeywordUnderstander(): Understander {
  return {
    async understand({ text, catalog }): Promise<Understanding> {
      const message = text.trim();
      // "Yes, 100 flyers" is a request, not a yes to the last quote.
      if (!/\d/.test(message)) {
        if (CONFIRM.test(message)) return { intent: "confirm", items: [], message: null };
        if (CANCEL.test(message)) return { intent: "cancel", items: [], message: null };
        if (CATALOGUE.test(message)) return { intent: "catalogue", items: [], message: menu(catalog) };
      }

      const lines = message.split(/\n|;|,\s*(?=\d)|\band\b/i).map((l) => l.trim()).filter(Boolean);
      const items: Understanding["items"] = [];
      for (const line of lines) {
        const item = menuPick(line, catalog) ?? wordMatch(line, catalog);
        if (!item) return { intent: "other", items: [], message: menu(catalog) };
        items.push(item);
      }
      return items.length > 0 ? { intent: "quote", items, message: null } : { intent: "other", items: [], message: menu(catalog) };
    },
  };
}

function menuPick(line: string, catalog: CatalogEntry[]) {
  const m = line.match(MENU_PICK);
  if (!m) return null;
  const entry = catalog[Number(m[1]) - 1];
  const quantity = Number(m[2]);
  return entry && quantity >= 1 ? { variantId: entry.id, quantity } : null;
}

function words(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9]+|[0-9]+[a-z]+/g) ?? [])
    .map((w) => (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

const STOP = new Set(["of", "per", "price", "pack", "the", "and", "for", "with", "pc", "piece", "copy", "unit", "want", "need", "pl", "please", "abeg", "how", "much", "cost", "make", "i", "me", "my", "some", "dey"]);

/** "50 tote bags": one quantity, and words that fit exactly one item better than any other. */
function wordMatch(line: string, catalog: CatalogEntry[]) {
  const numbers = line.match(/\b\d{1,7}\b/g) ?? [];
  if (numbers.length !== 1) return null;
  const quantity = Number(numbers[0]);
  const said = new Set(words(line));
  if (quantity < 1 || said.size === 0) return null;

  let best: CatalogEntry | null = null;
  let bestScore = 0;
  let tie = false;
  for (const entry of catalog) {
    const score = [...new Set(words(entry.name))].filter((w) => said.has(w)).length;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }
  return best && !tie ? { variantId: best.id, quantity } : null;
}

function menu(catalog: CatalogEntry[]): string {
  const shown = catalog.slice(0, MENU_SIZE);
  return [
    "Here's what we offer:",
    ...shown.map((c, i) => `${i + 1}. ${c.name}`),
    ...(catalog.length > shown.length ? ["(and more: ask the team)"] : []),
    "",
    "Reply with the item number and how many, one per line. For example: *1 x 100*",
  ].join("\n");
}

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { HistoryEntry } from "../../core/product.js";

// The AI step: reads the customer's message and works out WHAT they want
// (which products, how many) and whether they're confirming or cancelling.
// The AI is not given the price list's prices and its answer has no place for
// a price; every quote is priced in code from the database (see pricing.ts).

export interface Understanding {
  intent: "quote" | "confirm" | "cancel" | "catalogue" | "other";
  /** Requested items, using variant ids from the price list. */
  items: Array<{ variantId: string; quantity: number }>;
  /** For "catalogue": variant ids of the products they asked to see; empty for everything. */
  show?: string[];
  /** A short reply for the customer when we can't quote yet (unclear request, question, greeting). */
  message: string | null;
}

export interface CatalogEntry {
  id: string;
  name: string;
  minQuantity: number;
}

export interface Understander {
  understand(input: { text: string; history: HistoryEntry[]; catalog: CatalogEntry[] }): Promise<Understanding>;
}

const OutputSchema = z.object({
  intent: z.enum(["quote", "confirm", "cancel", "catalogue", "other"]),
  items: z.array(z.object({ ref: z.string(), quantity: z.number().int() })),
  show: z.array(z.string()),
  message: z.string().nullable(),
});

/**
 * @param description what the business does, e.g. "a print shop" or "a bakery".
 *   Each business using the bot sets its own; without one it's just "a business".
 */
export function buildSystemPrompt(businessName: string, catalog: CatalogEntry[], description?: string): string {
  const list = catalog.map((c, i) => `- ref p${i + 1}: ${c.name} (minimum ${c.minQuantity})`).join("\n");
  return `You work the WhatsApp line for ${businessName}, ${description?.trim() || "a business"} in Nigeria. Customers message to get price quotes and place orders. Code you can't see works out every price from the business's price list, so your job is only to understand the customer.

The business sells exactly these items:
${list}

Some items are priced by the team case by case; still list them as items with their quantity, and the system will pass them on.

Read the customer's latest message, using the earlier chat for context, and fill in:
- intent:
  - "quote" when they ask for a price or want to order items from the list. Put each item in items with its ref and quantity. If they changed an earlier request, give the full updated list.
  - "confirm" when they accept the quote they were just sent (yes, ok, go ahead, confirm).
  - "cancel" when they turn down or cancel the quote they were just sent.
  - "catalogue" when they ask to see the catalogue, menu, price list, photos or what the business sells, or ask the price of an item without saying how many. The system then shows them product cards with prices.
  - "other" for anything else: greetings, questions, things not on the list, or a request too vague to quote.
- items: only for "quote", otherwise empty. Use only refs from the list above. Count quantity in the unit the item name gives: single items one by one, packs as packs (300 pieces sold in packs of 100 is 3 packs), and square feet for items priced per square foot (6ft x 3ft is 18; round any part of a square foot up). If the customer doesn't say the size, type or quantity and more than one item could fit, don't guess: use "other" and ask.
- show: only for "catalogue": refs of the items they asked about, or empty to show everything.
- message: for "other" and "catalogue", a short, friendly reply in plain English (customers may write in Pidgin; you can reply in simple English). Ask what's missing, or say what the business sells. Otherwise null.

Never mention a price, total, discount or amount of money in message, even if the customer asks. Prices are only sent by the system. If they ask the price of something, use intent "quote" when you can tell what they want and how many, otherwise "catalogue".`;
}

export function createClaudeUnderstander(opts: {
  apiKey: string;
  model: string;
  businessName: string;
  /** What the business does, e.g. "a print shop". */
  description?: string;
  client?: Anthropic;
}): Understander {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });

  return {
    async understand({ text, history, catalog }) {
      const messages: Anthropic.MessageParam[] = [];
      for (const h of history) {
        messages.push({ role: h.direction === "inbound" ? "user" : "assistant", content: h.text });
      }
      // The API needs the conversation to start with the customer.
      while (messages.length > 0 && messages[0]!.role !== "user") messages.shift();
      messages.push({ role: "user", content: text });

      const response = await client.messages.parse({
        model: opts.model,
        max_tokens: 2000,
        system: buildSystemPrompt(opts.businessName, catalog, opts.description),
        messages,
        output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
      });

      const parsed = response.parsed_output;
      if (response.stop_reason === "refusal" || !parsed) {
        throw new Error(`AI could not read the message (stop_reason: ${response.stop_reason})`);
      }

      const byRef = new Map(catalog.map((c, i) => [`p${i + 1}`, c.id]));
      return {
        intent: parsed.intent,
        items: parsed.items.flatMap((item) => {
          const variantId = byRef.get(item.ref);
          return variantId && item.quantity >= 1 ? [{ variantId, quantity: item.quantity }] : [];
        }),
        show: parsed.show.flatMap((ref) => byRef.get(ref) ?? []),
        message: parsed.message,
      };
    },
  };
}

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { HistoryEntry } from "../../core/product.js";

// The AI step: reads the customer's message and works out WHAT they want
// (which products, how many) and whether they're confirming or cancelling.
// The AI is not given the price list's prices and its answer has no place for
// a price; every quote is priced in code from the database (see pricing.ts).

export interface Understanding {
  intent: "quote" | "confirm" | "cancel" | "other";
  /** Requested items, using variant ids from the price list. */
  items: Array<{ variantId: string; quantity: number }>;
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
  intent: z.enum(["quote", "confirm", "cancel", "other"]),
  items: z.array(z.object({ ref: z.string(), quantity: z.number().int() })),
  message: z.string().nullable(),
});

export function buildSystemPrompt(businessName: string, catalog: CatalogEntry[]): string {
  const list = catalog.map((c, i) => `- ref p${i + 1}: ${c.name} (minimum ${c.minQuantity})`).join("\n");
  return `You work the WhatsApp line for ${businessName}, a print shop in Nigeria. Customers message to get price quotes and place orders. Code you can't see works out every price from the shop's price list, so your job is only to understand the customer.

The shop sells exactly these items:
${list}

Some items are priced by the team case by case; still list them as items with their quantity, and the system will pass them on.

Read the customer's latest message, using the earlier chat for context, and fill in:
- intent:
  - "quote" when they ask for a price or want to order items from the list. Put each item in items with its ref and quantity. If they changed an earlier request, give the full updated list.
  - "confirm" when they accept the quote they were just sent (yes, ok, go ahead, confirm).
  - "cancel" when they turn down or cancel the quote they were just sent.
  - "other" for anything else: greetings, questions, things not on the list, or a request too vague to quote.
- items: only for "quote", otherwise empty. Use only refs from the list above. Count quantity in the unit the item name gives: flyers one by one, packs as packs (300 pouches is 3 packs of 100), and square feet for items priced per square foot (a 6ft x 3ft banner is 18; round any part of a square foot up). If the customer doesn't say the size, paper or quantity and more than one item could fit, don't guess: use "other" and ask.
- message: for "other", a short, friendly reply in plain English (customers may write in Pidgin; you can reply in simple English). Ask what's missing, or say what the shop sells. Otherwise null.

Never mention a price, total, discount or amount of money in message, even if the customer asks. Prices are only sent by the system. If they ask the price of something, use intent "quote" when you can tell what they want, or ask what they need.`;
}

export function createClaudeUnderstander(opts: {
  apiKey: string;
  model: string;
  businessName: string;
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
        system: buildSystemPrompt(opts.businessName, catalog),
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
        message: parsed.message,
      };
    },
  };
}

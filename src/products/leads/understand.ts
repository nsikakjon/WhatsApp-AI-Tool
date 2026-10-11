import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { HistoryEntry } from "../../core/product.js";
import {
  FINANCING,
  TIMELINES,
  describeDetails,
  type LeadDetails,
  type Purpose,
} from "./qualify.js";

// The AI step: reads what the person said and pulls out their answers
// (buy or rent, property, area, budget, timeline, financing), and writes a
// friendly next question. Scoring and deciding when to alert an agent happen
// in code (qualify.ts and index.ts), not here.

export interface Understanding {
  /** Answers found in the latest message. Null means "not mentioned", keep what we had. */
  details: LeadDetails;
  /** They asked to speak to a person, call, or book a viewing. */
  wantsAgent: boolean;
  /** A short reply: the next question, or an answer to what they asked. */
  message: string;
}

export interface LeadUnderstander {
  understand(input: {
    text: string;
    history: HistoryEntry[];
    known: LeadDetails;
    missing: string[];
    /** An agent has already been alerted about this person. */
    handedOff: boolean;
  }): Promise<Understanding>;
}

const OutputSchema = z.object({
  name: z.string().nullable(),
  // Checked against the allowed values in code (toUnderstanding), so one odd
  // answer doesn't throw away the rest of the message.
  purpose: z.string().nullable(),
  propertyType: z.string().nullable(),
  location: z.string().nullable(),
  budgetNaira: z.number().int().nullable(),
  timeline: z.string().nullable(),
  financing: z.string().nullable(),
  wantsAgent: z.boolean(),
  message: z.string(),
});

export function buildSystemPrompt(businessName: string): string {
  return `You answer the WhatsApp line for ${businessName}, a real estate business in Nigeria. People message about buying or renting property. Your job is to find out what they need, one or two questions at a time, so an agent can follow up with the right options. You never see the listings.

From the person's latest message (using the earlier chat for context), fill in only what they have told you; use null for anything they haven't said:
- name: their name, if they give it.
- purpose: "buy" or "rent" (investing or land banking counts as "buy"; short-let or lease counts as "rent").
- propertyType: what they want, in a few words, e.g. "3 bedroom flat", "4 bedroom duplex", "plot of land", "shop".
- location: the area(s) they want, e.g. "Lekki Phase 1 or Ajah".
- budgetNaira: the most they said they can spend, as a whole number of naira. "50m" or "50 million" is 50000000; "2.5m" is 2500000; for a range use the top. For rent, the yearly amount (12 times a monthly figure). Null if they haven't said.
- timeline: "now" (within a month or urgently), "1-3 months", "3-6 months", "later" (more than 6 months), or "just looking".
- financing: "cash" (including paying rent upfront), "mortgage approved", "payment plan" (instalments), "needs mortgage", or "unsure".
- wantsAgent: true if they ask to speak to a person, want a call, or want to book an inspection or viewing.
- message: a short, warm reply in plain English (they may write in Pidgin; reply in simple English). If they asked something, answer briefly first. Then ask for the next thing on the "still to ask" list, one or two at a time. Never ask again for something already known.

Never state a price, a property's availability, or that a specific property exists, and never promise a discount or a viewing time: say an agent will confirm. Don't invent anything.`;
}

function knownSummary(known: LeadDetails, missing: string[], handedOff: boolean): string {
  const lines = describeDetails(known);
  if (known.name) lines.unshift(`Name: ${known.name}`);
  return `Already known:\n${lines.length ? lines.join("\n") : "(nothing yet)"}\nStill to ask: ${missing.length ? missing.join(", ") : "(nothing, all answered)"}${
    handedOff ? "\nAn agent has already been told about this person and will contact them; say so if they ask what happens next." : ""
  }`;
}

export function createClaudeLeadUnderstander(opts: {
  apiKey: string;
  model: string;
  businessName: string;
  client?: Anthropic;
}): LeadUnderstander {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });

  return {
    async understand({ text, history, known, missing, handedOff }) {
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
        system: `${buildSystemPrompt(opts.businessName)}\n\n${knownSummary(known, missing, handedOff)}`,
        messages,
        output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
      });

      const parsed = response.parsed_output;
      if (response.stop_reason === "refusal" || !parsed) {
        throw new Error(`AI could not read the message (stop_reason: ${response.stop_reason})`);
      }
      return toUnderstanding(parsed);
    },
  };
}

/** Turns the AI's answer into our types. Budget becomes whole kobo here, in code. */
export function toUnderstanding(parsed: z.infer<typeof OutputSchema>): Understanding {
  const budgetKobo =
    parsed.budgetNaira !== null && Number.isSafeInteger(parsed.budgetNaira * 100) && parsed.budgetNaira > 0
      ? parsed.budgetNaira * 100
      : null;
  return {
    details: {
      name: parsed.name?.trim() || null,
      purpose: oneOf<Purpose>(parsed.purpose, ["buy", "rent"]),
      propertyType: parsed.propertyType?.trim() || null,
      location: parsed.location?.trim() || null,
      budgetKobo,
      timeline: oneOf(parsed.timeline, TIMELINES),
      financing: oneOf(parsed.financing, FINANCING),
    },
    wantsAgent: parsed.wantsAgent,
    message: parsed.message.trim(),
  };
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  const v = value?.trim().toLowerCase();
  return allowed.find((a) => a === v) ?? null;
}

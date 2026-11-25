import Anthropic from "@anthropic-ai/sdk";
import { formatNaira } from "../../core/money.js";
import type { HistoryEntry } from "../../core/product.js";
import type { PlanStore, QuotePlan } from "./plan.js";

// yarnOga customer support on the quotes number (chat-signup.ts). Visitors
// and signed-up owners can ask what yarnOga does, and the AI answers from the
// facts below, which are written here in code. Plan prices never come from
// the AI: a question about them gets the list built from the quote_plans
// table (planList). An answer holding a number the facts don't have is
// thrown away, so the AI can't make up a price, a limit or a date.
//
// The AI can also say the visitor is really trying to order from a shop
// ("how much for 20 mugs?"), so they're taken to the Demo Shop, or that it
// can't tell what they want.

export type SupportReply = { kind: "answer"; text: string } | { kind: "plans" } | { kind: "demo" } | { kind: "unclear" };

export interface SupportRequest {
  question: string;
  history: HistoryEntry[];
  /** The plans with what each adds (no prices), from planFacts. */
  plans: string;
  /** Set for an owner who has already signed up. */
  businessName?: string | null;
}

export interface SupportWriter {
  /** Null when the AI failed or wrote a number the facts don't have. */
  answer(req: SupportRequest): Promise<SupportReply | null>;
}

const FACTS = `yarnOga (run by YarnOga Africa Ventures, a registered Nigerian business based in Lagos, serving businesses across Africa) gives a business a WhatsApp assistant on its own number.

What the assistant does for the business's customers, day and night:
- Answers questions and "how much?" with the business's own price list. Prices are always the owner's, never guessed.
- Understands typed messages and voice notes, and replies in English, Pidgin, Hausa, Swahili or French.
- Sends quotes, takes orders, asks delivery or pickup with the business's own delivery areas and fees, and sends invoices and receipts.
- Sends a pay link so customers can pay online, and reminds customers who haven't paid.
- Shows products with photos as cards customers swipe through, and gives the business a one-page online shop.
- Follows up after orders, asks for ratings and lets customers order again.
- Books appointments for gyms, clinics, salons and coaches: customers pick a free time, get a reminder, and can move or cancel (Pro plan and up).
- Sells event tickets, each with a QR code checked at the door.
- Hands a chat to a person whenever the customer asks, and the owner or staff can take over any chat at any time.

What the owner gets in the yarnOga owner app (on the phone or computer):
- An inbox of every chat, with staff accounts and roles.
- Every order in one place, an order board, and a sales dashboard with a morning summary.
- Walk-in counter sales with barcodes, and a till that keeps working offline.
- Pickup screens, and kitchen and bar screens for restaurants and venues.
- A customer list, low-stock alerts, and broadcasts to customers (sent in paid packs).
- Business flyers made for them, and a business advisor that reads their sales and gives plain advice (Pro plan and up).
- Branches, each with its own number, on the bigger plans.

Getting started:
- It's free to start, with no card. Send *sign up* and the assistant is set up right here in this chat in about 5 minutes: business name, what they sell, and their prices (typed, a voice note, a photo of a price list, or a spreadsheet).
- A business using the WhatsApp Business app connects its number with Facebook in about 5 minutes and keeps using the app; its number and chats stay. A business can also use a new number.
- Send *set it up for me* and the yarnOga team sets it up with them.
- Send *book a walkthrough* for a 20-minute call where the yarnOga team shows yarnOga with their own products.
- Tap *See it as a customer* (or send *demo*) to try the yarnOga Demo Shop and see what customers see. Send *exit demo* to come back.
- Send *plans* to see every plan's price.`;

export function buildSupportPrompt(req: SupportRequest): string {
  const who = req.businessName
    ? `You're talking to the owner of ${req.businessName}, who has already signed up. They can send *try* to chat with their own bot, *prices* to change their price list, *connect* to connect their number, and *talk to someone* for the team.`
    : "You're talking to someone who may want yarnOga for their business.";
  return `You are yarnOga support on WhatsApp. ${who}

Answer only from these facts:

${FACTS}

Plans (cheapest first) and what each adds:
${req.plans}

Rules:
- Answer the question in 2 to 4 short sentences of plain, friendly English. WhatsApp formatting only (*bold*), no headings. If it helps, end with one next step (sign up, try the demo, book a walkthrough).
- Never write a number that isn't in the facts above: no prices, amounts, percentages, limits, dates or phone numbers. Never say what a plan costs.
- If they ask what something costs, which plan to pick by price, or about fees, reply with exactly: PLANS
- If they're writing as a shop's customer, trying to order or asking the price of an item ("how much for 20 T-shirts?", "I want a cake"), reply with exactly: DEMO
- If you can't tell what they want, or it's not about yarnOga, reply with exactly: UNCLEAR
- If they ask for something the facts don't cover, say you're not sure it does that yet and suggest booking a walkthrough to ask the team. Never make up a feature.
- Never name other companies, apps or tools, never say which AI or technology is behind yarnOga, and never share anyone's phone number, bank details or personal details.`;
}

/** Numbers in a text, as plain digits: "₦45,000" -> "45000". List markers ("1. ") don't count. */
function numbersIn(text: string): string[] {
  return (text.replace(/^\s*\d{1,2}[.)]\s/gm, "").match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.+$/, ""));
}

export function createClaudeSupport(opts: {
  apiKey: string;
  model: string;
  onUsage?: (usage: Anthropic.Usage) => void;
  client?: Anthropic;
  log?: Pick<Console, "warn" | "error">;
}): SupportWriter {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  const log = opts.log ?? console;
  return {
    async answer(req) {
      const system = buildSupportPrompt(req);
      const earlier = req.history.slice(-8).filter((h) => h.text.trim());
      const chat = earlier.length ? `Earlier in this chat:\n${earlier.map((h) => `${h.direction === "inbound" ? "Them" : "Us"}: ${h.text.slice(0, 400)}`).join("\n")}\n\n` : "";
      try {
        const response = await client.messages.create({
          model: opts.model,
          max_tokens: 400,
          system,
          messages: [{ role: "user", content: `${chat}Their message: ${req.question.slice(0, 1000)}` }],
        });
        opts.onUsage?.(response.usage);
        const text = response.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("")
          .trim();
        if (!text) return null;
        const marker = text.replace(/[^A-Z]/g, "");
        if (text.length <= 12 && marker === "PLANS") return { kind: "plans" };
        if (text.length <= 12 && marker === "DEMO") return { kind: "demo" };
        if (text.length <= 12 && marker === "UNCLEAR") return { kind: "unclear" };
        const allowed = new Set(numbersIn(system));
        if (!numbersIn(text).every((n) => allowed.has(n))) {
          log.warn("yarnOga support: dropped an answer with a number the facts don't have.");
          return null;
        }
        return { kind: "answer", text };
      } catch (err) {
        log.error("yarnOga support: the AI failed:", err);
        return null;
      }
    },
  };
}

/** What each plan adds, without prices, for the AI. */
export function planFacts(free: QuotePlan | null, paid: QuotePlan[]): string {
  return [...(free ? [free] : []), ...paid].map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n");
}

/** Every plan with its price from the quote_plans table, as a WhatsApp message. */
export function planList(free: QuotePlan | null, paid: QuotePlan[], addons: Array<{ name: string; priceKobo: number }> = []): string {
  const lines = ["yarnOga plans:"];
  if (free) lines.push(`• ${free.name}: free${free.description ? `. ${capital(free.description)}` : ""}`);
  for (const p of paid) {
    const yearly = p.monthlyPricePaidYearlyKobo != null ? ` (${formatNaira(p.monthlyPricePaidYearlyKobo)}/month paid yearly)` : "";
    const setup = p.setupFeeKobo > 0 ? ` + ${formatNaira(p.setupFeeKobo)} setup` : "";
    lines.push(`• ${p.name}: ${formatNaira(p.monthlyPriceKobo)}/month${yearly}${setup}${p.description ? `. ${capital(p.description)}` : ""}`);
  }
  if (addons.length) {
    lines.push("", "Extras (one-off):");
    for (const a of addons) lines.push(`• ${a.name}: ${formatNaira(a.priceKobo)}`);
  }
  lines.push("", "Every business starts free, with no card. Send *sign up* to start, or *book a walkthrough* for a 20-minute call with the yarnOga team.");
  return lines.join("\n");
}

/** The plans from the database, or null when they can't be read. */
export async function readPlans(store: Pick<PlanStore, "plan" | "paidPlans" | "addons">, log: Pick<Console, "error"> = console) {
  try {
    const [free, paid, addons] = await Promise.all([store.plan("free"), store.paidPlans(), store.addons?.() ?? []]);
    return { free, paid, addons };
  } catch (err) {
    log.error("yarnOga support: could not read the plans:", err);
    return null;
  }
}

function capital(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

/** "What are your plans?", "pricing", "how much is yarnOga". */
const PLANS = new RegExp(
  "^(plans?|pricing|prices|packages|subscriptions?)$" +
    "|\\b(your|ur|the|yarnoga( s)?|una) (plans?|pricing|packages|subscriptions?|price plans?)\\b" +
    "|\\bhow much (is|does|do|for) (yarnoga|it cost|this cost|the bot|your bot|this bot|the (pro|starter|growth|enterprise) plan|(pro|starter|growth|enterprise))\\b" +
    "|\\b(pro|starter|growth|enterprise) plan (cost|price)\\b",
);

export function asksAboutPlans(text: string): boolean {
  const plain = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return plain.length <= 120 && PLANS.test(plain);
}

/** "I'd like to book a 20-minute walkthrough", "can we schedule a demo call". */
const WALKTHROUGH = /\b(walk ?-?through|book (a |an )?(demo|call|meeting|session|appointment with (you|yarnoga|the team))|demo (call|meeting|session)|schedule (a |an )?(call|demo|meeting)|(talk|speak) (to|with) (sales|your sales team))\b/i;

export function asksForWalkthrough(text: string): boolean {
  return text.length <= 300 && WALKTHROUGH.test(text);
}

/** Leaving the Demo Shop: "exit demo", "back to yarnOga", the button. */
const EXIT_DEMO = /^((exit|leave|end|stop|quit|close|done with)( the)? demo( shop)?|back to yarnoga( support)?|yarnoga support|exit)$/;

export function leavesDemo(text: string): boolean {
  return EXIT_DEMO.test(text.toLowerCase().replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim());
}

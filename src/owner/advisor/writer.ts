import Anthropic from "@anthropic-ai/sdk";

// The business advisor's words. Code works out every figure (numbers.ts) and
// hands them over as text; the AI only writes plain advice around them. Any
// answer that holds a number the facts don't have is thrown away, so a
// made-up price, total or percentage can never reach the owner.

export type AdviceLang = "en" | "fr";

export interface AdviceRequest {
  shopName: string;
  /** What the shop does, as the owner wrote it. */
  description: string | null;
  language: AdviceLang;
  /** The figures, exactly as the owner sees them. */
  facts: string;
  /** What to write. */
  task: string;
}

export interface AdviceWriter {
  /** The advice, or null when the AI failed or wrote a number it wasn't given. */
  write(req: AdviceRequest): Promise<string | null>;
}

/** Numbers in a text, as plain digits: "₦45,000" -> "45000", "12.5%" -> "12.5". List markers ("1. ") don't count. */
export function numbersIn(text: string): string[] {
  return (text.replace(/^\s*\d{1,2}[.)]\s/gm, "").match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.+$/, ""));
}

/** True when every number in the advice is one of the facts' numbers. */
export function onlyGivenNumbers(advice: string, facts: string): boolean {
  const allowed = new Set(numbersIn(facts));
  return numbersIn(advice).every((n) => allowed.has(n));
}

export function buildAdvicePrompt(req: AdviceRequest): string {
  const language = req.language === "fr" ? "French" : "English";
  return `You are a friendly business advisor for ${req.shopName}${req.description ? `, ${req.description},` : ""} a small business in Africa that sells on WhatsApp. The owner asked you a question in their yarnOga app. Below are their own figures, worked out from their sales records.

Rules:
- Use only the figures given. Never write a number that isn't in them: no new prices, totals, percentages, targets, discounts or dates. Say "a small discount" or "raise the price a little", not an amount. Don't count or number your points ("3 ideas", "1."): start each with "•" instead.
- Don't repeat every figure: the owner sees them above your words. Pick what matters.
- Write in ${language}, in plain everyday words a market trader would use. No jargon, no headings, no tables. WhatsApp formatting only (*bold*), and use it sparingly.
- Be specific to these figures and this shop. No general business theory.
- If the figures are too thin to say much (a new shop, few sales), say so kindly and suggest one simple next step.

Your task: ${req.task}`;
}

export function createClaudeAdviceWriter(opts: {
  apiKey: string;
  model: string;
  /** Told the tokens each answer used, to count what this shop costs us. */
  onUsage?: (usage: Anthropic.Usage) => void;
  client?: Anthropic;
  log?: Pick<Console, "warn" | "error">;
}): AdviceWriter {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  const log = opts.log ?? console;
  return {
    async write(req) {
      try {
        const response = await client.messages.create({
          model: opts.model,
          max_tokens: 800,
          system: buildAdvicePrompt(req),
          messages: [{ role: "user", content: `My figures:\n${req.facts}` }],
        });
        opts.onUsage?.(response.usage);
        const text = response.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("")
          .trim();
        if (!text) return null;
        if (!onlyGivenNumbers(text, req.facts)) {
          log.warn(`Business advisor: dropped an answer for ${req.shopName} with a number it wasn't given.`);
          return null;
        }
        return text;
      } catch (err) {
        log.error(`Business advisor: the AI failed for ${req.shopName}:`, err);
        return null;
      }
    },
  };
}

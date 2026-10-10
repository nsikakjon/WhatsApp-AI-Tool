import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// The AI step: reads a day's worth of site updates (texts, photo captions,
// voice note transcripts) and sorts them into a short progress summary. Counts
// and dates in the report are worked out in code, not by the AI.

export interface UpdateForSummary {
  /** Lagos time, e.g. "09:14". */
  time: string;
  who: string;
  kind: "text" | "photo" | "voice";
  text: string | null;
}

export interface Summary {
  /** Two or three sentences on how the day went. */
  overview: string;
  workDone: string[];
  problems: string[];
  materialsNeeded: string[];
  nextSteps: string[];
}

export interface Summariser {
  summarise(input: { siteName: string; date: string; updates: UpdateForSummary[] }): Promise<Summary>;
}

const OutputSchema = z.object({
  overview: z.string(),
  workDone: z.array(z.string()),
  problems: z.array(z.string()),
  materialsNeeded: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

export const SYSTEM_PROMPT = `You write the end-of-day progress report for a construction site in Nigeria. Site staff send short WhatsApp updates during the day: typed messages, photo captions and voice note transcripts. They often write in Pidgin or informal English; write the report in clear, simple English for the site manager.

Fill in:
- overview: two or three sentences on how the day went.
- workDone: what was done or progressed (e.g. "Ground floor slab cast", "Blockwork on first floor about half done").
- problems: delays, safety issues, breakdowns, missing workers, weather, anything blocking work.
- materialsNeeded: materials or equipment staff said are short or needed, with quantities if they gave them.
- nextSteps: what staff said will happen next.

Each list item is one short line. Merge repeated points. Leave a list empty if nothing fits.

Only use what the updates say. Never invent progress, numbers, quantities, names or prices. If an update is unclear, leave it out rather than guess. Photos without a caption are only counted by the system; don't describe them.`;

export function formatUpdatesForAi(updates: UpdateForSummary[]): string {
  return updates
    .map((u) => {
      const label = u.kind === "photo" ? "photo" : u.kind === "voice" ? "voice note" : "message";
      return `[${u.time}] ${u.who} (${label}): ${u.text?.trim() || "(no caption)"}`;
    })
    .join("\n");
}

export function createClaudeSummariser(opts: { apiKey: string; model: string; client?: Anthropic }): Summariser {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });

  return {
    async summarise({ siteName, date, updates }) {
      const response = await client.messages.parse({
        model: opts.model,
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Site: ${siteName}\nDate: ${date}\n\nToday's updates:\n${formatUpdatesForAi(updates)}`,
          },
        ],
        output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
      });

      const parsed = response.parsed_output;
      if (response.stop_reason === "refusal" || !parsed) {
        throw new Error(`AI could not summarise the updates (stop_reason: ${response.stop_reason})`);
      }
      return parsed;
    },
  };
}

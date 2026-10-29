import Anthropic from "@anthropic-ai/sdk";
import type { Lang } from "../../core/i18n.js";

// The short birthday message that goes with each flyer. The AI writes a fresh
// one each time so the group doesn't see the same words every birthday; if the
// AI is switched off or fails, a ready-made message is used instead.

export interface WishWriter {
  write(input: { name: string; groupName: string; lang?: Lang }): Promise<string>;
}

const FALLBACKS = [
  "Happy birthday, {first}! 🎉 Wishing you joy, good health and a wonderful year ahead. Cheers from all of us at {group}! 🥂",
  "Happy birthday, {first}! 🎂 May this new year bring you more blessings, laughter and success. With love from {group} ❤️",
  "It's {first}'s birthday today! 🎉 Happy birthday, and many happy returns from your {group} family 🎈",
  "Happy birthday, {first}! 🥳 We celebrate you today and always. Have a fantastic day! From {group}",
];

const FALLBACKS_FR = [
  "Joyeux anniversaire, {first} ! 🎉 Nous te souhaitons de la joie, une bonne santé et une merveilleuse année. De la part de tous à {group} ! 🥂",
  "Joyeux anniversaire, {first} ! 🎂 Que cette nouvelle année t'apporte bénédictions, rires et réussite. Avec amour, {group} ❤️",
  "C'est l'anniversaire de {first} aujourd'hui ! 🎉 Bonne fête de la part de toute la famille {group} 🎈",
  "Joyeux anniversaire, {first} ! 🥳 On te célèbre aujourd'hui et toujours. Passe une excellente journée ! {group}",
];

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** A ready-made message, chosen by name so the same person gets the same one. */
export function fallbackWish(name: string, groupName: string, lang?: Lang): string {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  const list = lang === "fr" ? FALLBACKS_FR : FALLBACKS;
  return list[sum % list.length]!.replace("{first}", firstName(name)).replace("{group}", groupName);
}

export const SYSTEM_PROMPT = `You write the short message posted with a birthday flyer in an African WhatsApp group (school alumni, old friends, colleagues).

Write one warm, upbeat birthday message of one or two sentences (under 220 characters) that:
- addresses the person by their first name,
- mentions the group by name once,
- includes one or two fitting emojis.

Keep it friendly and suitable for everyone in the group. Don't invent facts about the person (age, job, family, achievements). Reply with the message only, nothing else.`;

export function createWishWriter(opts: {
  apiKey?: string;
  model: string;
  client?: Anthropic;
  log?: Pick<Console, "error">;
}): WishWriter {
  const log = opts.log ?? console;
  const client = opts.client ?? (opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : undefined);

  return {
    async write({ name, groupName, lang }) {
      if (!client) return fallbackWish(name, groupName, lang);
      try {
        const response = await client.messages.create({
          model: opts.model,
          max_tokens: 300,
          system: lang === "fr" ? `${SYSTEM_PROMPT}\n\nWrite the message in French (as spoken in French-speaking Africa), using "tu".` : SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Name: ${name}\nGroup: ${groupName}` }],
        });
        const text = response.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("")
          .trim();
        if (response.stop_reason !== "end_turn" || !text || text.length > 400) {
          return fallbackWish(name, groupName, lang);
        }
        return text;
      } catch (err) {
        log.error("AI birthday message failed, using a ready-made one:", err);
        return fallbackWish(name, groupName, lang);
      }
    },
  };
}

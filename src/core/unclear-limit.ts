import type { Product } from "./product.js";

const HOUR = 3_600_000;

export interface UnclearLimitOptions {
  /** Replies the bot gives to messages it can't make sense of before it goes quiet. */
  replies?: number;
  /** How long the bot stays quiet before it answers such messages again. */
  hours?: number;
  now?: () => Date;
}

/**
 * Stops the bot answering a chat again and again when the messages have no
 * clear request ("Hmmm", random words, gibberish). After the set number of
 * such replies it stays quiet in that chat until the hours have passed since
 * the last one. Any message the bot can act on starts the count again.
 *
 * Products mark these replies with stage "unclear". Kept in memory: a restart
 * simply starts every count again.
 */
export function withUnclearLimit(bot: Product, opts: UnclearLimitOptions = {}): Product {
  const limit = opts.replies ?? 2;
  const quietMs = (opts.hours ?? 6) * HOUR;
  const now = opts.now ?? (() => new Date());
  const chats = new Map<string, { count: number; last: number }>();

  return {
    name: bot.name,
    async handle(msg, ctx) {
      const reply = await bot.handle(msg, ctx);
      if (!reply) return reply;
      const key = `${msg.businessNumberId ?? ""}:${msg.from}`;
      const { stage, ...rest } = reply;
      if (stage !== "unclear") {
        chats.delete(key);
        return reply;
      }

      const at = now().getTime();
      const chat = chats.get(key);
      if (chat && at - chat.last < quietMs) {
        if (chat.count >= limit) return null;
        chat.count++;
        chat.last = at;
      } else {
        chats.set(key, { count: 1, last: at });
        if (chats.size > 1000) {
          for (const [k, c] of chats) if (at - c.last >= quietMs) chats.delete(k);
        }
      }
      return rest;
    },
  };
}

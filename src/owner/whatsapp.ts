import { SUMMARY_SEEN } from "./summary.js";
import type { Notice, Product, ProductContext, Reply } from "../core/product.js";
import { LINK_MINUTES, newLoginToken } from "./auth.js";
import type { UserStore } from "./store.js";

// The owner app's two jobs inside the WhatsApp chat. Both wrap the quote bot
// without changing it:
//   withAppLogin    the owner or a staff member sends "app" and gets a
//                   one-time login link to the app
//   withAlertCopies new-order and other owner alerts also go to the extra
//                   alert numbers the owner added in the app

export const APP_COMMAND = /^\s*(app|login|log ?in|open app|my app)\s*[.!]?\s*$/i;

export interface LoginBusiness {
  id: string;
  /** The owner's number: they get an owner login the first time they ask. */
  ownerWaId: string | null;
}

export function withAppLogin(
  bot: Product,
  opts: {
    /** The business answering on this WhatsApp number (undefined = main number). */
    businessFor(numberId: string | undefined): Promise<LoginBusiness | null>;
    users: UserStore;
    publicUrl: string;
    now?: () => Date;
    log?: Pick<Console, "error">;
  },
): Product {
  const log = opts.log ?? console;
  return {
    name: bot.name,
    async handle(msg, ctx) {
      // The "Got it" button under the morning summary: a thank-you, no AI.
      if (msg.text === SUMMARY_SEEN) return { text: "👍 See you tomorrow morning." };
      if (msg.type === "text" && msg.text && APP_COMMAND.test(msg.text)) {
        try {
          const business = await opts.businessFor(msg.businessNumberId);
          if (business) {
            const user =
              business.ownerWaId && msg.from === business.ownerWaId
                ? await opts.users.ensureOwner(business.id, msg.from)
                : (await opts.users.byWaId(msg.from)).find((u) => u.businessId === business.id) ?? null;
            if (user) {
              const now = opts.now?.() ?? new Date();
              const { token, hash } = newLoginToken();
              await opts.users.saveToken(user.id, hash, new Date(now.getTime() + LINK_MINUTES * 60_000));
              return {
                text: [
                  `Here's your yarnOga app: ${opts.publicUrl}/app/l/${token}`,
                  "",
                  `The link works once, for ${LINK_MINUTES} minutes. Don't forward it: whoever opens it is logged in as you.`,
                  "To log in without WhatsApp next time, set a password in the app under Settings.",
                ].join("\n"),
              };
            }
          }
        } catch (err) {
          // E.g. migration 0049 not run yet: the bot answers as it always has.
          log.error("Could not make an app login link:", err);
        }
      }
      return bot.handle(msg, ctx);
    },
  };
}

/** The notices, plus a copy of each one to the owner for every extra alert number. */
export function copyOwnerNotices(notices: Notice[], ownerWaId: string | undefined, extra: string[]): Notice[] {
  if (!ownerWaId) return notices;
  const toOwner = notices.filter((n) => n.to === ownerWaId);
  const others = [...new Set(extra)].filter((n) => n !== ownerWaId);
  if (!toOwner.length || !others.length) return notices;
  return [...notices, ...others.flatMap((to) => toOwner.map((n) => ({ ...n, to })))];
}

export function withAlertCopies(
  bot: Product,
  opts: {
    ownerWaId: string | undefined;
    /** The extra alert numbers (digits). */
    numbers(): Promise<string[]>;
    cacheMs?: number;
    now?: () => number;
    log?: Pick<Console, "error">;
  },
): Product {
  const log = opts.log ?? console;
  const now = opts.now ?? Date.now;
  const cacheMs = opts.cacheMs ?? 60_000;
  let cached: { at: number; list: string[] } | null = null;

  async function extra(): Promise<string[]> {
    if (cached && now() - cached.at < cacheMs) return cached.list;
    try {
      cached = { at: now(), list: await opts.numbers() };
    } catch (err) {
      log.error("Could not read the extra alert numbers:", err);
      cached = { at: now(), list: [] };
    }
    return cached.list;
  }

  async function copy(reply: Reply | null): Promise<Reply | null> {
    if (!reply?.notify?.length || !opts.ownerWaId || !reply.notify.some((n) => n.to === opts.ownerWaId)) return reply;
    return { ...reply, notify: copyOwnerNotices(reply.notify, opts.ownerWaId, await extra()) };
  }

  return {
    name: bot.name,
    async handle(msg, ctx) {
      const wrapped: ProductContext = { ...ctx, sendLater: async (later) => ctx.sendLater((await copy(later)) ?? later) };
      return copy(await bot.handle(msg, wrapped));
    },
  };
}

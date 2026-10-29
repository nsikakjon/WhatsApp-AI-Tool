import type { Product, ProductContext, Reply } from "../product.js";
import type { IncomingMessage } from "../whatsapp/types.js";
import type { EmailProduct, EmailStore } from "./store.js";

// Asking our customers for an email in WhatsApp, once, right after something
// has worked for them (their price list saved, their third flyer member
// added). The product writes the question; this adds how to answer, notes the
// ask, and answers the reply on any of our numbers:
//
//   an email address   saved, with their agreement to tips and the words they saw
//   skip               (only straight after the ask) no emails, and we don't ask again
//   stop emails        unsubscribes every email we send to this number

export const HOW_TO_ANSWER = "Send your email address, or send *skip*.";

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;
const SKIP = /^(skip|no|no thanks|no thank you|not now|nope)[.!]*$/i;
const STOP = /^((stop|unsubscribe( from)?)( all)?|no more) e-?mails?[.!]*$/i;

/** Domains people often mistype, with what they meant. */
const TYPOS: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmal.com": "gmail.com",
  "gnail.com": "gmail.com",
  "yahoo.co": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "outlok.com": "outlook.com",
};

export interface EmailAsker {
  /**
   * The question plus how to answer, to add to a reply. Null when this person
   * already gave an email for this account or said no, so they're never asked twice.
   */
  ask(a: { product: EmailProduct; accountId: string; waId: string; question: string; source: string }): Promise<string | null>;
}

export function createEmailAsker(store: EmailStore, opts: { now?: () => Date; log?: Pick<Console, "error"> } = {}): EmailAsker {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;
  return {
    async ask(a) {
      try {
        const known = await store.forAccount(a.product, a.accountId);
        // Once per person, and not at all when someone on the account already gets the emails.
        if (known.some((c) => c.email && !c.unsubscribedAt) || known.some((c) => c.waId === a.waId && c.askedAt)) return null;
        const text = `${a.question} ${HOW_TO_ANSWER}`;
        await store.save(a.product, a.accountId, a.waId, { askedAt: now(), tipsSource: a.source, tipsWording: text });
        return text;
      } catch (err) {
        // E.g. migration 0057 not run yet: no question, the chat carries on.
        log.error("Could not note the email question:", err);
        return null;
      }
    },
  };
}

/** The one address in a short message ("my email is ada@x.com"), lowercased. */
export function emailIn(text: string): string | null {
  if (text.length > 160) return null;
  const found = text.match(EMAIL);
  return found?.length === 1 ? found[0].toLowerCase().replace(/\.+$/, "") : null;
}

/** "ada@gamil.com" -> "ada@gmail.com"; null when the domain looks fine. */
export function likelyTypo(email: string): string | null {
  const [user, domain] = email.split("@");
  const fixed = TYPOS[domain ?? ""];
  return fixed ? `${user}@${fixed}` : null;
}

/** True when one of our last few messages to them was the email question. */
const justAsked = (ctx: ProductContext) =>
  ctx.history
    .filter((h) => h.direction === "outbound")
    .slice(-3)
    .some((h) => h.text.includes(HOW_TO_ANSWER));

export function withEmailReplies(next: Product, opts: { store: EmailStore; now?: () => Date; log?: Pick<Console, "error"> }): Product {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;
  return {
    name: next.name,
    async handle(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null> {
      const text = msg.type === "text" ? (msg.text ?? "").trim() : "";
      if (!text) return next.handle(msg, ctx);
      try {
        if (STOP.test(text)) {
          const mine = await opts.store.byWaId(msg.from);
          if (mine.length) {
            const active = mine.filter((c) => c.email && !c.unsubscribedAt);
            await opts.store.update(active.map((c) => c.id), { unsubscribedAt: now() });
            return {
              text: active.length
                ? "Done. You won't get any more emails from yarnOga. Everything else keeps working as normal."
                : "You're not getting any emails from yarnOga, so there's nothing to stop.",
            };
          }
        }

        const email = emailIn(text);
        const skip = !email && SKIP.test(text) && justAsked(ctx);
        if (email || skip) {
          const open = (await opts.store.byWaId(msg.from)).filter((c) => c.askedAt && !c.email && !c.declinedAt);
          if (open.length) {
            const ids = open.map((c) => c.id);
            if (skip) {
              await opts.store.update(ids, { declinedAt: now() });
              return { text: "No problem, no emails. Everything you need is here in WhatsApp." };
            }
            const fix = likelyTypo(email!);
            if (fix) return { text: `Did you mean *${fix}*? Please send your email address again, written the way you want it.` };
            await opts.store.update(ids, { email, tipsAt: now(), unsubscribedAt: null, firstName: msg.contactName?.trim() || null });
            return {
              text: `Thanks, I'll send setup tips to ${email}, one short email at a time. Send *stop emails* here any time to stop them.`,
            };
          }
        }
      } catch (err) {
        log.error("Could not handle an email reply:", err);
      }
      return next.handle(msg, ctx);
    },
  };
}

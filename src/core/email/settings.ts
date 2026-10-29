import { emailIn, likelyTypo } from "./ask.js";
import type { EmailProduct, EmailStore } from "./store.js";

// The email box and tick box an owner fills in themselves (owner app
// Settings, the /signup page). The address is for receipts and account
// emails; tips only go out when the box is ticked.

export const TIPS_BOX = "Send me setup tips and yarnOga news. One email a week at most. Unsubscribe any time.";

export interface EmailSettings {
  get(product: EmailProduct, accountId: string, waId: string): Promise<{ email: string | null; tips: boolean }>;
  /** Saves the address and choice. "bad" or "typo" (e.g. gamil.com) when the address doesn't look right; nothing is saved then. */
  save(a: { product: EmailProduct; accountId: string; waId: string; name?: string | null; email: string; tips: boolean; source: string }): Promise<"bad" | "typo" | null>;
}

export function createEmailSettings(store: EmailStore, opts: { now?: () => Date } = {}): EmailSettings {
  const now = opts.now ?? (() => new Date());
  return {
    async get(product, accountId, waId) {
      const c = (await store.forAccount(product, accountId)).find((x) => x.waId === waId);
      return { email: c?.email ?? null, tips: Boolean(c?.email && c.tipsAt && !c.unsubscribedAt) };
    },
    async save(a) {
      const typed = a.email.trim();
      const existing = (await store.forAccount(a.product, a.accountId)).find((x) => x.waId === a.waId);
      if (!typed) {
        if (existing) await store.update([existing.id], { email: null, tipsAt: null, receiptsAt: null });
        return null;
      }
      const email = emailIn(typed);
      if (!email || email !== typed.toLowerCase()) return "bad";
      if (likelyTypo(email)) return "typo";
      const subscribed = Boolean(existing?.tipsAt && !existing.unsubscribedAt && existing.email === email);
      await store.save(a.product, a.accountId, a.waId, {
        email,
        ...(a.name ? { firstName: a.name } : {}),
        ...(existing?.receiptsAt && existing.email === email ? {} : { receiptsAt: now(), receiptsSource: a.source }),
        ...(a.tips
          ? subscribed
            ? {}
            : { tipsAt: now(), tipsSource: a.source, tipsWording: TIPS_BOX, unsubscribedAt: null }
          : existing?.tipsAt && !existing.unsubscribedAt
            ? { unsubscribedAt: now() }
            : {}),
      });
      return null;
    },
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";

// Who gets yarnOga's emails (migration 0057): one row per person per account
// (a quote business or a flyer group), with their consent kept apart for tips
// and for receipts, and a row for each email of the series once it's done.

export type EmailProduct = "quote" | "flyer" | "site" | "leads";

export interface EmailContact {
  id: string;
  product: EmailProduct;
  accountId: string;
  /** Empty when we don't know their WhatsApp number (e.g. from the /signup page). */
  waId: string;
  firstName: string | null;
  email: string | null;
  askedAt: Date | null;
  declinedAt: Date | null;
  /** When they agreed to tips; null = no tips. */
  tipsAt: Date | null;
  receiptsAt: Date | null;
  unsubscribedAt: Date | null;
  seriesStartedAt: Date | null;
}

export type ContactChange = Partial<{
  firstName: string | null;
  email: string | null;
  askedAt: Date | null;
  declinedAt: Date | null;
  tipsAt: Date | null;
  tipsSource: string | null;
  tipsWording: string | null;
  receiptsAt: Date | null;
  receiptsSource: string | null;
  unsubscribedAt: Date | null;
  seriesStartedAt: Date | null;
}>;

export type SendStatus = "sent" | "skipped" | "failed";

export interface EmailStore {
  get(id: string): Promise<EmailContact | null>;
  forAccount(product: EmailProduct, accountId: string): Promise<EmailContact[]>;
  byWaId(waId: string): Promise<EmailContact[]>;
  /** Creates the row for this person and account, or changes it. */
  save(product: EmailProduct, accountId: string, waId: string, change: ContactChange): Promise<EmailContact>;
  update(ids: string[], change: ContactChange): Promise<void>;
  /** Everyone who agreed to tips, has an address and hasn't unsubscribed. */
  subscribed(): Promise<EmailContact[]>;
  /** Each contact's finished emails: key, how it ended and when. */
  sends(contactIds: string[]): Promise<Map<string, Array<{ key: string; status: SendStatus; at: Date }>>>;
  /** Records an email as done. False when it was already recorded (another run got there first). */
  record(contactId: string, key: string, status: SendStatus, resendId?: string): Promise<boolean>;
  sentSince(since: Date): Promise<number>;
}

type Row = {
  id: string;
  product: EmailProduct;
  account_id: string;
  wa_id: string;
  first_name: string | null;
  email: string | null;
  asked_at: string | null;
  declined_at: string | null;
  tips_at: string | null;
  receipts_at: string | null;
  unsubscribed_at: string | null;
  series_started_at: string | null;
};

const date = (v: string | null) => (v ? new Date(v) : null);
const toContact = (r: Row): EmailContact => ({
  id: r.id,
  product: r.product,
  accountId: r.account_id,
  waId: r.wa_id,
  firstName: r.first_name,
  email: r.email,
  askedAt: date(r.asked_at),
  declinedAt: date(r.declined_at),
  tipsAt: date(r.tips_at),
  receiptsAt: date(r.receipts_at),
  unsubscribedAt: date(r.unsubscribed_at),
  seriesStartedAt: date(r.series_started_at),
});

const COLUMNS: Record<keyof ContactChange, string> = {
  firstName: "first_name",
  email: "email",
  askedAt: "asked_at",
  declinedAt: "declined_at",
  tipsAt: "tips_at",
  tipsSource: "tips_source",
  tipsWording: "tips_wording",
  receiptsAt: "receipts_at",
  receiptsSource: "receipts_source",
  unsubscribedAt: "unsubscribed_at",
  seriesStartedAt: "series_started_at",
};

function toRow(change: ContactChange): Record<string, unknown> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(change)) {
    row[COLUMNS[key as keyof ContactChange]] = value instanceof Date ? value.toISOString() : value;
  }
  return row;
}

export function createSupabaseEmails(db: SupabaseClient): EmailStore {
  const list = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) => {
    const { data, error } = await q;
    if (error) throw new Error(`${what} failed: ${error.message}`);
    return ((data ?? []) as Row[]).map(toContact);
  };
  return {
    async get(id) {
      const { data, error } = await db.from("email_contacts").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(`email contact lookup failed: ${error.message}`);
      return data ? toContact(data as Row) : null;
    },
    forAccount: (product, accountId) =>
      list(db.from("email_contacts").select("*").eq("product", product).eq("account_id", accountId), "email contacts for account"),
    byWaId: (waId) => list(db.from("email_contacts").select("*").eq("wa_id", waId), "email contacts by number"),
    async save(product, accountId, waId, change) {
      const { data, error } = await db
        .from("email_contacts")
        .upsert({ product, account_id: accountId, wa_id: waId, ...toRow(change) }, { onConflict: "product,account_id,wa_id" })
        .select("*")
        .single();
      if (error) throw new Error(`save email contact failed: ${error.message}`);
      return toContact(data as Row);
    },
    async update(ids, change) {
      if (!ids.length) return;
      const { error } = await db.from("email_contacts").update(toRow(change)).in("id", ids);
      if (error) throw new Error(`update email contacts failed: ${error.message}`);
    },
    subscribed: () =>
      list(
        db.from("email_contacts").select("*").not("tips_at", "is", null).not("email", "is", null).is("unsubscribed_at", null).limit(5000),
        "subscribed email contacts",
      ),
    async sends(contactIds) {
      const out = new Map<string, Array<{ key: string; status: SendStatus; at: Date }>>();
      for (let i = 0; i < contactIds.length; i += 200) {
        const { data, error } = await db
          .from("email_sends")
          .select("contact_id, email_key, status, created_at")
          .in("contact_id", contactIds.slice(i, i + 200));
        if (error) throw new Error(`email sends lookup failed: ${error.message}`);
        for (const r of (data ?? []) as Array<{ contact_id: string; email_key: string; status: SendStatus; created_at: string }>) {
          const done = out.get(r.contact_id) ?? [];
          done.push({ key: r.email_key, status: r.status, at: new Date(r.created_at) });
          out.set(r.contact_id, done);
        }
      }
      return out;
    },
    async record(contactId, key, status, resendId) {
      const { error } = await db.from("email_sends").insert({ contact_id: contactId, email_key: key, status, resend_id: resendId ?? null });
      if (error?.code === "23505") return false;
      if (error) throw new Error(`record email send failed: ${error.message}`);
      return true;
    },
    async sentSince(since) {
      const { count, error } = await db
        .from("email_sends")
        .select("contact_id", { count: "exact", head: true })
        .eq("status", "sent")
        .gte("created_at", since.toISOString());
      if (error) throw new Error(`count email sends failed: ${error.message}`);
      return count ?? 0;
    },
  };
}

/** In memory, for tests. */
export function memoryEmails(now: () => Date = () => new Date()): EmailStore & { contacts: EmailContact[]; done: Array<{ contactId: string; key: string; status: SendStatus; at: Date; resendId?: string }> } {
  const contacts: EmailContact[] = [];
  const done: Array<{ contactId: string; key: string; status: SendStatus; at: Date; resendId?: string }> = [];
  const apply = (c: EmailContact, change: ContactChange) => {
    for (const [k, v] of Object.entries(change)) if (k in c) (c as unknown as Record<string, unknown>)[k] = v;
  };
  let next = 1;
  return {
    contacts,
    done,
    async get(id) {
      return contacts.find((c) => c.id === id) ?? null;
    },
    async forAccount(product, accountId) {
      return contacts.filter((c) => c.product === product && c.accountId === accountId);
    },
    async byWaId(waId) {
      return contacts.filter((c) => c.waId === waId);
    },
    async save(product, accountId, waId, change) {
      let c = contacts.find((x) => x.product === product && x.accountId === accountId && x.waId === waId);
      if (!c) {
        c = { id: `c${next++}`, product, accountId, waId, firstName: null, email: null, askedAt: null, declinedAt: null, tipsAt: null, receiptsAt: null, unsubscribedAt: null, seriesStartedAt: null };
        contacts.push(c);
      }
      apply(c, change);
      return c;
    },
    async update(ids, change) {
      for (const c of contacts) if (ids.includes(c.id)) apply(c, change);
    },
    async subscribed() {
      return contacts.filter((c) => c.tipsAt && c.email && !c.unsubscribedAt);
    },
    async sends(ids) {
      const out = new Map<string, Array<{ key: string; status: SendStatus; at: Date }>>();
      for (const d of done) if (ids.includes(d.contactId)) out.set(d.contactId, [...(out.get(d.contactId) ?? []), { key: d.key, status: d.status, at: d.at }]);
      return out;
    },
    async record(contactId, key, status, resendId) {
      if (done.some((d) => d.contactId === contactId && d.key === key)) return false;
      done.push({ contactId, key, status, at: now(), resendId });
      return true;
    },
    async sentSince(since) {
      return done.filter((d) => d.status === "sent" && d.at >= since).length;
    },
  };
}

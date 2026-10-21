import type { SupabaseClient } from "@supabase/supabase-js";
import type { Reply } from "../../core/product.js";
import { parseCsv, sheetCsvUrl } from "../../core/sheets.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { compareLists, priceListCsv, readPriceList, type PriceListItem } from "./pricelist.js";
import type { SetupStore } from "./store.js";

// Price lists kept in step with the owner's Google Sheet (QUOTE_PRICE_SHEETS,
// migration 0040). The link is remembered when a list is saved from a sheet,
// or when the owner sends one. The server reads the sheet once a day, and
// the owner can send "refresh" any time. Changes are never used on their
// own: the owner sees what changed and sends "update prices" to use them.

export interface SheetStore {
  sheet(businessId: string): Promise<{ url: string | null; pendingCsv: string | null }>;
  setSheet(businessId: string, url: string | null): Promise<void>;
  setPending(businessId: string, csv: string | null): Promise<void>;
  /** Businesses with a sheet that hasn't been read since this time. */
  dueForCheck(before: Date): Promise<Array<{ id: string; ownerWaId: string | null; phoneNumberId: string | null; active: boolean }>>;
  checked(businessId: string): Promise<void>;
}

export type SheetCheck =
  | { kind: "no-sheet" }
  | { kind: "unchanged" }
  | { kind: "problems"; message: string }
  | { kind: "changed"; items: PriceListItem[]; summary: string; isNew: boolean };

export interface SheetSync {
  /** Reads the sheet and keeps any changes waiting for the owner. */
  check(businessId: string): Promise<SheetCheck>;
  /** Uses the waiting changes. Returns how many items the list now has, or null if nothing was waiting. */
  apply(businessId: string): Promise<number | null>;
  remember(businessId: string, url: string | null): Promise<void>;
  /** The owner's "refresh", "update prices" and sheet-link messages; null for anything else. */
  ownerCommand(businessId: string, msg: IncomingMessage): Promise<Reply | null>;
}

export const SHEET_LINK = /https:\/\/docs\.google\.com\/spreadsheets\/\S+/;
const REFRESH = /^(refresh|refresh prices|sync|sync prices)[.!]*$/i;
const UPDATE = /^(update prices|use new prices)[.!]*$/i;
const STOP = /^(stop refresh|stop sync|unlink sheet)[.!]*$/i;

export function createSheetSync(opts: {
  store: SheetStore;
  setup: Pick<SetupStore, "priceList" | "replacePriceList">;
  fetchSheet: (link: string) => Promise<string>;
  /** Writes a price list for WhatsApp (chat-signup.ts preview). */
  preview: (items: PriceListItem[]) => string;
}): SheetSync {
  const sync: SheetSync = {
    async check(businessId) {
      const { url, pendingCsv } = await opts.store.sheet(businessId);
      if (!url) return { kind: "no-sheet" };
      let csv: string;
      try {
        csv = await opts.fetchSheet(url);
      } catch (err) {
        return { kind: "problems", message: `I couldn't open your Google Sheet: ${err instanceof Error ? err.message : String(err)}.` };
      } finally {
        await opts.store.checked(businessId);
      }
      const { items, problems } = readPriceList(parseCsv(csv));
      if (problems.length || !items.length) {
        const list = problems.slice(0, 5).map((p) => `• Row ${p.line}: ${p.message}`).join("\n");
        return { kind: "problems", message: `Your Google Sheet has rows I can't read, so I've kept your current prices:\n${list}` };
      }
      const { added, changed, removed } = compareLists(await opts.setup.priceList(businessId), items);
      if (!added && !changed && !removed.length) {
        if (pendingCsv) await opts.store.setPending(businessId, null);
        return { kind: "unchanged" };
      }
      const next = priceListCsv(items);
      await opts.store.setPending(businessId, next);
      const parts = [added && `${added} new`, changed && `${changed} changed`, removed.length && `${removed.length} taken off`].filter(Boolean);
      return { kind: "changed", items, summary: parts.join(", "), isNew: next !== pendingCsv };
    },

    async apply(businessId) {
      const { pendingCsv } = await opts.store.sheet(businessId);
      if (!pendingCsv) return null;
      const { items, problems } = readPriceList(parseCsv(pendingCsv));
      if (problems.length || !items.length) return null;
      await opts.setup.replacePriceList(businessId, items);
      await opts.store.setPending(businessId, null);
      return items.length;
    },

    remember: (businessId, url) => opts.store.setSheet(businessId, url),

    async ownerCommand(businessId, msg) {
      const text = (msg.text ?? "").trim();
      const link = text.match(SHEET_LINK)?.[0];
      if (link && sheetCsvUrl(link)) {
        await sync.remember(businessId, link);
        return { text: await refreshText(businessId, "Got it, I'll check this Google Sheet for price changes every day.") };
      }
      if (REFRESH.test(text)) return { text: await refreshText(businessId) };
      if (UPDATE.test(text)) {
        const count = await sync.apply(businessId);
        return { text: count === null ? "There are no new prices waiting. Send *refresh* to check your Google Sheet." : `Done. Your price list now has ${count} items, and customers get the new prices from their next message.` };
      }
      if (STOP.test(text)) {
        await sync.remember(businessId, null);
        await opts.store.setPending(businessId, null);
        return { text: "Okay, I've stopped checking your Google Sheet. Your prices stay as they are." };
      }
      return null;
    },
  };

  async function refreshText(businessId: string, intro?: string): Promise<string> {
    const result = await sync.check(businessId);
    const lead = intro ? `${intro}\n\n` : "";
    switch (result.kind) {
      case "no-sheet":
        return 'Send me the link to your Google Sheet (shared as "Anyone with the link" can view) and I\'ll keep your prices in step with it.';
      case "unchanged":
        return `${lead}Your prices already match your Google Sheet.`;
      case "problems":
        return `${lead}${result.message}`;
      case "changed":
        return `${lead}Your Google Sheet has changes (${result.summary}).\n\n${opts.preview(result.items)}\n\nPlease check the prices, then send *update prices* to use them.`;
    }
  }

  return sync;
}

/** The daily check: reads each due sheet and tells owners about new changes. */
export async function checkDueSheets(opts: {
  sync: SheetSync;
  store: SheetStore;
  now: Date;
  /** Sends the owner a message from this number. */
  notify: (to: string, text: string, fromNumberId: string | undefined) => Promise<void>;
  /** The number owners whose own number isn't connected yet chat with us on (the sign-up number). */
  fallbackNumberId?: string;
  log?: Pick<Console, "error">;
}): Promise<void> {
  const log = opts.log ?? console;
  const before = new Date(opts.now.getTime() - 23 * 60 * 60 * 1000);
  for (const b of await opts.store.dueForCheck(before)) {
    try {
      const result = await opts.sync.check(b.id);
      if (result.kind !== "changed" || !result.isNew || !b.ownerWaId) continue;
      const from = b.active && b.phoneNumberId ? b.phoneNumberId : opts.fallbackNumberId;
      await opts.notify(b.ownerWaId, `Your Google Sheet price list has changes (${result.summary}). Send *refresh* to see them, then *update prices* to use them.`, from);
    } catch (err) {
      log.error(`Google Sheet check failed for business ${b.id}:`, err);
    }
  }
}

export function createSupabaseSheets(db: SupabaseClient): SheetStore {
  const update = async (businessId: string, values: Record<string, unknown>, what: string) => {
    const { error } = await db.from("quote_businesses").update(values).eq("id", businessId);
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };
  return {
    async sheet(businessId) {
      const { data, error } = await db.from("quote_businesses").select("price_sheet_url, pending_price_csv").eq("id", businessId).maybeSingle();
      if (error) throw new Error(`sheet lookup failed: ${error.message}`);
      return { url: data?.price_sheet_url ?? null, pendingCsv: data?.pending_price_csv ?? null };
    },
    setSheet: (businessId, url) => update(businessId, { price_sheet_url: url }, "setSheet"),
    setPending: (businessId, csv) => update(businessId, { pending_price_csv: csv }, "setPending"),
    checked: (businessId) => update(businessId, { sheet_checked_at: new Date().toISOString() }, "sheet checked"),
    async dueForCheck(before) {
      const { data, error } = await db
        .from("quote_businesses")
        .select("id, owner_wa_id, phone_number_id, active")
        .not("price_sheet_url", "is", null)
        .or(`sheet_checked_at.is.null,sheet_checked_at.lt.${before.toISOString()}`);
      if (error) throw new Error(`dueForCheck failed: ${error.message}`);
      return (data ?? []).map((r) => ({ id: r.id as string, ownerWaId: r.owner_wa_id as string | null, phoneNumberId: r.phone_number_id as string | null, active: r.active as boolean }));
    },
  };
}

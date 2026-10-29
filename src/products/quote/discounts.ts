import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../../core/money.js";
import type { SavedOrder } from "./store.js";

// Discount codes a business gives its own customers (QUOTE_DISCOUNT_CODES,
// migration 0042): a Christmas or Black Friday sale, or a code for an
// influencer to share, so the owner can see how many orders it brought in.
//
// The owner sends "new code XMAS 20% until 25 Dec limit 100". A customer with
// a quote sends XMAS, and the quote's items get 20% off. The discount is
// worked out in the database (quote_apply_discount) from the code's row,
// never by the AI.

export interface DiscountCode {
  code: string;
  percentOff: number;
  maxUses: number | null;
  endsAt: Date | null;
  active: boolean;
  /** Confirmed or paid orders that used it. */
  orders: number;
  /** What it took off those orders. */
  discountKobo: number;
}

export type ApplyResult =
  | { result: "applied"; code: string; percentOff: number; discountKobo: number; totalKobo: number }
  | { result: "unknown" | "ended" | "full" | "no_quote"; code: string };

export interface DiscountStore {
  apply(orderId: string, code: string): Promise<ApplyResult>;
  /** True when the business has this code switched on. */
  isCode(code: string): Promise<boolean>;
  codes(): Promise<DiscountCode[]>;
  /** Makes the code, or changes it (and switches it back on) if it exists. */
  save(code: { code: string; percentOff: number; maxUses: number | null; endsAt: Date | null }): Promise<void>;
  /** False when there's no such code. */
  setActive(code: string, active: boolean): Promise<boolean>;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "25 Dec", "25th December" or "25/12": the end of that day in Lagos, this year or next. */
export function parseEndDate(text: string, now: Date): Date | null {
  const t = text.trim().toLowerCase();
  let day: number;
  let month: number;
  const named = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*$/);
  const numeric = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (named && MONTHS.includes(named[2]!)) {
    day = Number(named[1]);
    month = MONTHS.indexOf(named[2]!) + 1;
  } else if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(2024, month, 0)).getUTCDate()) return null;
  // Midnight at the end of that day, Lagos time (UTC+1 all year).
  const endOf = (year: number) => new Date(Date.UTC(year, month - 1, day + 1) - 60 * 60 * 1000);
  const year = new Date(now.getTime() + 60 * 60 * 1000).getUTCFullYear();
  return endOf(year) > now ? endOf(year) : endOf(year + 1);
}

function dayText(date: Date): string {
  // A minute before the end, so "until 25 Dec" reads as the 25th.
  return new Date(date.getTime() - 60_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

type Money = (minor: number) => string;

function codeLine(c: DiscountCode, now: Date, money: Money): string {
  const ended = c.endsAt && c.endsAt <= now;
  const parts = [`${c.percentOff}% off`];
  if (c.endsAt) parts.push(ended ? `ended ${dayText(c.endsAt)}` : `until ${dayText(c.endsAt)}`);
  parts.push(`${c.orders} order${c.orders === 1 ? "" : "s"}${c.orders ? ` (${money(c.discountKobo)} off)` : ""}`);
  if (c.maxUses != null) parts.push(`${Math.max(c.maxUses - c.orders, 0)} left`);
  if (!c.active) parts.push("paused");
  return `• *${c.code}*: ${parts.join(", ")}`;
}

const HOW =
  "To make a code, send *new code*, a name and the discount, e.g. *new code XMAS 20%*. You can add an end date and a limit: *new code BLACKFRIDAY 30% until 29 Nov limit 100*. Customers send the code after they get a quote. *code XMAS off* pauses a code, and *on* starts it again.";

/** The owner's discount code commands. Null when the message isn't one. */
export async function discountCommand(store: DiscountStore, text: string, now = new Date(), money: Money = formatNaira): Promise<string | null> {
  const t = text.trim();
  if (/^(my |discount |sale )?codes$|^discounts?$/i.test(t)) {
    const codes = await store.codes();
    return codes.length ? `Your discount codes:\n${codes.map((c) => codeLine(c, now, money)).join("\n")}\n\n${HOW}` : `You have no discount codes yet.\n\n${HOW}`;
  }

  const make = t.match(/^(?:new|add|create|make)\s+(?:discount\s+|sale\s+)?code\s+(\S+)(.*)$/i);
  if (make) {
    const code = make[1]!.toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(code)) return "A code can only have letters and numbers, 4 to 20 of them, e.g. *new code XMAS 20%*.";
    let rest = make[2]!.trim();
    const percent = rest.match(/^(\d{1,3})\s*%(?:\s+off)?/i);
    if (!percent) return `How much off? e.g. *new code ${code} 20%*.`;
    const percentOff = Number(percent[1]);
    if (percentOff < 1 || percentOff > 90) return "The discount can be from 1% to 90%.";
    rest = rest.slice(percent[0].length).trim();

    let maxUses: number | null = null;
    const limit = rest.match(/(?:^|\s)(?:limit|max)\s+(\d{1,6})(?:\s+orders?)?\s*$/i);
    if (limit) {
      maxUses = Number(limit[1]);
      rest = rest.slice(0, limit.index).trim();
    }
    let endsAt: Date | null = null;
    const until = rest.match(/^(?:until|till|to|ends?)\s+(.+)$/i);
    if (until) {
      endsAt = parseEndDate(until[1]!, now);
      if (!endsAt) return "I couldn't read that date. Please write it like *until 25 Dec* or *until 25/12*.";
    } else if (rest) {
      return `I couldn't follow "${rest}". Try *new code ${code} ${percentOff}% until 25 Dec limit 100* (the date and limit are optional).`;
    }

    await store.save({ code, percentOff, maxUses, endsAt });
    const terms = [endsAt ? `until ${dayText(endsAt)}` : "", maxUses != null ? `for the first ${maxUses} orders` : ""].filter(Boolean).join(", ");
    return `Done. *${code}* gives ${percentOff}% off${terms ? `, ${terms}` : ""}. Customers send *${code}* after they get a quote. Send *codes* to see how many orders each code brings in.`;
  }

  const toggle = t.match(/^(?:discount\s+)?code\s+([a-z0-9]{4,20})\s+(on|off)$/i);
  if (toggle) {
    const code = toggle[1]!.toUpperCase();
    const on = toggle[2]!.toLowerCase() === "on";
    if (!(await store.setActive(code, on))) return `You don't have a code called ${code}. Send *codes* to see yours.`;
    return on ? `*${code}* works again.` : `*${code}* is paused. Customers can't use it until you send *code ${code} on*.`;
  }
  return null;
}

/** "XMAS", "code XMAS" or "promo code: XMAS". */
export function readCode(text: string): { code: string; explicit: boolean } | null {
  const m = text.trim().match(/^((?:promo|discount|coupon|voucher)\s+)?(code\s*:?\s*)?([a-z0-9]{4,20})[.!]?$/i);
  return m ? { code: m[3]!.toUpperCase(), explicit: !!(m[1] || m[2]) } : null;
}

/** The line a quote, invoice or owner alert shows for a discount. */
export function discountLine(d: { code: string; amountKobo: number }, money: Money = formatNaira): string {
  return `• Discount (${d.code}) = -${money(d.amountKobo)}`;
}

/**
 * A customer sending a code. Null when the message isn't a code, so the bot
 * reads it as usual ("thanks" is code-shaped but no business's code).
 */
export async function customerCode(
  store: DiscountStore,
  text: string,
  openQuote: () => Promise<SavedOrder | null>,
  ref: (order: SavedOrder) => string,
  money: Money = formatNaira,
): Promise<string | null> {
  const asked = readCode(text);
  if (!asked) return null;
  const { code, explicit } = asked;
  const order = await openQuote();
  const noQuote = `Ask me for a quote first, then send *${code}* before you reply YES and I'll take the discount off.`;
  if (!order) return explicit || (await store.isCode(code)) ? noQuote : null;

  const res = await store.apply(order.id, code);
  switch (res.result) {
    case "unknown":
      return explicit ? `*${code}* isn't a code I recognise. Please check the spelling.` : null;
    case "ended":
      return `Sorry, *${code}* has ended.`;
    case "full":
      return `Sorry, *${code}* has been used up.`;
    case "no_quote":
      return noQuote;
  }
  return [
    `Code *${res.code}* applied: ${res.percentOff}% off. Your quote (${ref(order)}) is now:`,
    "",
    ...order.lines.map((l) => `• ${l.quantity} x ${l.name} @ ${money(l.unitPriceKobo)} = ${money(l.totalKobo)}`),
    discountLine({ code: res.code, amountKobo: res.discountKobo }, money),
    "",
    `*Total: ${money(res.totalKobo)}*`,
    "",
    "Reply YES to place this order, or tell me what to change.",
  ].join("\n");
}

export function createSupabaseDiscounts(db: SupabaseClient, businessId: string): DiscountStore {
  return {
    async apply(orderId, code) {
      const { data, error } = await db.rpc("quote_apply_discount", { p_business_id: businessId, p_order_id: orderId, p_code: code });
      if (error) throw new Error(`quote_apply_discount failed: ${error.message}`);
      const row = (data as Array<{ result: ApplyResult["result"]; code: string; percent_off: number; discount_kobo: number | string; total_kobo: number | string }>)[0]!;
      return row.result === "applied"
        ? { result: "applied", code: row.code, percentOff: row.percent_off, discountKobo: Number(row.discount_kobo), totalKobo: Number(row.total_kobo) }
        : { result: row.result, code: row.code };
    },

    async isCode(code) {
      const { data, error } = await db
        .from("quote_discount_codes")
        .select("id")
        .eq("business_id", businessId)
        .eq("code", code)
        .eq("active", true)
        .maybeSingle();
      if (error) throw new Error(`discount code lookup failed: ${error.message}`);
      return !!data;
    },

    async codes() {
      const { data, error } = await db
        .from("quote_discount_codes")
        .select("code, percent_off, max_uses, ends_at, active")
        .eq("business_id", businessId)
        .order("created_at");
      if (error) throw new Error(`discount codes failed: ${error.message}`);
      if (!data?.length) return [];
      const { data: orders, error: ordersError } = await db
        .from("quote_orders")
        .select("discount_code, discount_kobo")
        .eq("business_id", businessId)
        .in("status", ["confirmed", "paid"])
        .in("discount_code", data.map((c) => c.code));
      if (ordersError) throw new Error(`discount code orders failed: ${ordersError.message}`);
      return data.map((c) => {
        const used = (orders ?? []).filter((o) => o.discount_code === c.code);
        return {
          code: c.code,
          percentOff: c.percent_off,
          maxUses: c.max_uses,
          endsAt: c.ends_at ? new Date(c.ends_at) : null,
          active: c.active,
          orders: used.length,
          discountKobo: used.reduce((sum, o) => sum + Number(o.discount_kobo), 0),
        };
      });
    },

    async save(c) {
      const { error } = await db.from("quote_discount_codes").upsert(
        {
          business_id: businessId,
          code: c.code,
          percent_off: c.percentOff,
          max_uses: c.maxUses,
          ends_at: c.endsAt?.toISOString() ?? null,
          active: true,
        },
        { onConflict: "business_id,code" },
      );
      if (error) throw new Error(`save discount code failed: ${error.message}`);
    },

    async setActive(code, active) {
      const { data, error } = await db
        .from("quote_discount_codes")
        .update({ active })
        .eq("business_id", businessId)
        .eq("code", code)
        .select("code");
      if (error) throw new Error(`discount code update failed: ${error.message}`);
      return (data ?? []).length === 1;
    },
  };
}

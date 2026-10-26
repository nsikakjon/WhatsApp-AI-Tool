import { formatMoney } from "../core/money.js";
import type { OutgoingButtons } from "../core/whatsapp/client.js";
import type { AppBusiness } from "./types.js";

// The owner's morning summary on WhatsApp: yesterday's orders and money,
// what's still unpaid, the best seller and anything running low. Built from
// the same figures as the app's dashboard; nothing here is worked out by AI.

/** At or below this many left, an item counts as running low (the same as the app's "low stock" tag). */
export const LOW_STOCK = 5;
/** The button under the summary. Tapping it keeps WhatsApp's free window open for tomorrow's summary. */
export const SUMMARY_SEEN = "yarnoga summary seen";

/** Midnight in Lagos (UTC+1) at the start of the day `daysBack` days before `now`. */
export function lagosDayStart(now: Date, daysBack = 0): Date {
  const lagos = new Date(now.getTime() + 60 * 60_000);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() - daysBack) - 60 * 60_000);
}

/** "2026-10-26": the Lagos date, used to send one summary a day. */
export function lagosDate(now: Date): string {
  return new Date(now.getTime() + 60 * 60_000).toISOString().slice(0, 10);
}

export interface DailySummary {
  text: string;
  buttons: OutgoingButtons;
}

/** Yesterday in figures, or null when there's nothing worth a message (no orders, nothing unpaid, nothing low). */
export async function dailySummary(biz: AppBusiness, now: Date, appUrl?: string): Promise<DailySummary | null> {
  const money = (minor: number) => formatMoney(minor, biz.currency);
  const start = lagosDayStart(now, 1);
  const end = lagosDayStart(now, 0);
  const [sales, recent, top, products, rated] = await Promise.all([
    biz.board.sales(start, end),
    biz.board.orders(lagosDayStart(now, 14)),
    biz.data.topItems(start, 1).catch(() => []),
    biz.prices.products().catch(() => []),
    biz.data.ratings ? biz.data.ratings(start).catch(() => null) : Promise.resolve(null),
  ]);
  const unpaid = recent.filter((o) => o.status === "confirmed");
  const owed = unpaid.reduce((sum, o) => sum + o.totalKobo, 0);
  const low = products.flatMap((p) =>
    p.options.filter((o) => o.stock !== null && o.stock <= LOW_STOCK).map((o) => `${p.name}${p.options.length > 1 ? ` (${o.name})` : ""}: ${o.stock} left`),
  );
  if (sales.orders === 0 && sales.paidInKobo === 0 && unpaid.length === 0 && low.length === 0) return null;

  const lines = [
    `☀️ Good morning! Yesterday at *${biz.name}*:`,
    `• Orders: ${sales.orders}${sales.quotes ? ` (from ${sales.quotes} quote${sales.quotes === 1 ? "" : "s"})` : ""}`,
    `• Paid in: ${money(sales.paidInKobo)}`,
    ...(top[0] ? [`• Best seller: ${top[0].name} (${top[0].quantity})`] : []),
    ...(rated?.count ? [`• Ratings: ${rated.average!.toFixed(1)} / 5 from ${rated.count}${rated.bad ? ` (${rated.bad} not good)` : ""}`] : []),
    ...(unpaid.length ? ["", `💰 Waiting for payment: ${unpaid.length} order${unpaid.length === 1 ? "" : "s"}, ${money(owed)}`] : []),
    ...(low.length ? ["", "📦 Running low:", ...low.slice(0, 6).map((l) => `• ${l}`), ...(low.length > 6 ? [`• and ${low.length - 6} more`] : [])] : []),
    ...(appUrl ? ["", `More in your app: ${appUrl}/app`] : []),
  ];
  return {
    text: lines.join("\n"),
    buttons: { body: "Tap below so tomorrow's summary reaches you too.", buttons: [{ id: SUMMARY_SEEN, title: "Got it ✅" }] },
  };
}

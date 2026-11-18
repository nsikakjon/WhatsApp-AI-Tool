import type { ProductRecord } from "../store.js";

// The figures behind the business advisor's five questions, worked out here
// from the shop's own orders, counter sales and price list. Every number an
// owner sees comes from these functions; the AI only writes advice around
// them (writer.ts). Money is in kobo (or the shop's currency's hundredths).

const DAY = 86_400_000;
/** A customer who ordered at least this often and then went quiet this long has "stopped buying". */
export const LAPSED_MIN_ORDERS = 2;
export const LAPSED_DAYS = 30;
/** "How is my shop doing?" compares the last 30 days with the 30 before. */
export const PERIOD_DAYS = 30;
/** An item with no sale in this long is slow. */
export const SLOW_DAYS = 60;
/** Busiest days are counted over the last 8 weeks. */
export const BUSY_DAYS = 56;
/** Bulk prices are checked against the biggest single purchase in this long. */
export const TIER_DAYS = 90;

export interface AdvisorLine {
  /** The price list option it was sold from (WhatsApp orders); counter sales match by name. */
  variantId?: string | null;
  /** "Product: option", as the price list names it. */
  name: string;
  quantity: number;
  totalKobo: number;
  /** The cost price when it was sold; null when none was entered. */
  unitCostKobo: number | null;
}

/** A confirmed or paid WhatsApp order. */
export interface AdvisorOrder {
  customerId: string;
  name: string | null;
  waId: string;
  confirmedAt: Date;
  paidAt: Date | null;
  totalKobo: number;
  lines: AdvisorLine[];
}

/** A counter sale that wasn't cancelled. */
export interface AdvisorCounterSale {
  at: Date;
  totalKobo: number;
  lines: AdvisorLine[];
}

export interface AdvisorData {
  /** The last year's confirmed and paid orders. */
  orders: AdvisorOrder[];
  /** The last 90 days' counter sales. */
  counter: AdvisorCounterSale[];
  products: ProductRecord[];
}

// ---- 1. How is my shop doing? ----

export interface Period {
  /** Money paid in: orders paid in the period plus counter sales. */
  salesKobo: number;
  /** WhatsApp orders confirmed plus counter sales made. */
  orders: number;
  averageKobo: number | null;
  /** WhatsApp customers who ordered, and how many of them had ordered before. */
  customers: number;
  repeat: number;
  /** Orders from the period not paid by its end. */
  unpaid: number;
  unpaidKobo: number;
}

function period(data: AdvisorData, from: Date, to: Date): Period {
  const inRange = (d: Date | null) => d !== null && d >= from && d < to;
  const orders = data.orders.filter((o) => inRange(o.confirmedAt));
  const counter = data.counter.filter((s) => inRange(s.at));
  const paidIn = data.orders.filter((o) => inRange(o.paidAt)).reduce((t, o) => t + o.totalKobo, 0);
  const counterKobo = counter.reduce((t, s) => t + s.totalKobo, 0);
  const count = orders.length + counter.length;
  const value = orders.reduce((t, o) => t + o.totalKobo, 0) + counterKobo;
  const people = new Set(orders.map((o) => o.customerId));
  const before = new Set(data.orders.filter((o) => o.confirmedAt < from).map((o) => o.customerId));
  const twice = new Set(orders.map((o) => o.customerId).filter((id, i, all) => all.indexOf(id) !== i));
  const unpaid = orders.filter((o) => !o.paidAt || o.paidAt >= to);
  return {
    salesKobo: paidIn + counterKobo,
    orders: count,
    // Rounded to whole naira: an average is a guide, not a price.
    averageKobo: count ? Math.round(value / count / 100) * 100 : null,
    customers: people.size,
    repeat: [...people].filter((id) => before.has(id) || twice.has(id)).length,
    unpaid: unpaid.length,
    unpaidKobo: unpaid.reduce((t, o) => t + o.totalKobo, 0),
  };
}

export function shopHealth(data: AdvisorData, now: Date): { recent: Period; before: Period } {
  const start = new Date(now.getTime() - PERIOD_DAYS * DAY);
  return { recent: period(data, start, now), before: period(data, new Date(start.getTime() - PERIOD_DAYS * DAY), start) };
}

// ---- 2. Who stopped buying? ----

export interface LapsedCustomer {
  name: string | null;
  waId: string;
  orders: number;
  spentKobo: number;
  lastOrderAt: Date;
}

/** Customers with 2 or more orders and nothing in the last 30 days, biggest spenders first. */
export function lapsedCustomers(data: AdvisorData, now: Date): LapsedCustomer[] {
  const cutoff = now.getTime() - LAPSED_DAYS * DAY;
  const people = new Map<string, LapsedCustomer>();
  for (const o of data.orders) {
    const c = people.get(o.customerId) ?? { name: o.name, waId: o.waId, orders: 0, spentKobo: 0, lastOrderAt: o.confirmedAt };
    c.orders++;
    if (o.paidAt) c.spentKobo += o.totalKobo;
    if (o.confirmedAt > c.lastOrderAt) c.lastOrderAt = o.confirmedAt;
    people.set(o.customerId, c);
  }
  return [...people.values()]
    .filter((c) => c.orders >= LAPSED_MIN_ORDERS && c.lastOrderAt.getTime() < cutoff)
    .sort((a, b) => b.spentKobo - a.spentKobo || b.lastOrderAt.getTime() - a.lastOrderAt.getTime());
}

// ---- 3. How do I sell more? ----

export interface ItemSales {
  /** The product's name on the price list (or the line's name when it's no longer there). */
  name: string;
  quantity: number;
  totalKobo: number;
}

/** Monday first. */
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

interface Sold extends AdvisorLine {
  at: Date;
}

function soldSince(data: AdvisorData, since: Date): Sold[] {
  return [
    ...data.orders.filter((o) => o.confirmedAt >= since).flatMap((o) => o.lines.map((l) => ({ ...l, at: o.confirmedAt }))),
    ...data.counter.filter((s) => s.at >= since).flatMap((s) => s.lines.map((l) => ({ ...l, at: s.at }))),
  ];
}

/** Which product each sold line belongs to: by its option's id, else by its "Product: option" name. */
function productIndex(products: ProductRecord[]) {
  const byVariant = new Map<string, ProductRecord>();
  const byName = new Map<string, ProductRecord>();
  for (const p of products) {
    for (const o of p.options) {
      if (o.id) byVariant.set(o.id, p);
      byName.set(`${p.name}: ${o.name}`, p);
    }
    byName.set(p.name, p);
  }
  return (l: AdvisorLine) => (l.variantId ? byVariant.get(l.variantId) : undefined) ?? byName.get(l.name) ?? null;
}

/** Products by money taken since then, most first. */
export function bestSellers(data: AdvisorData, since: Date): ItemSales[] {
  const productOf = productIndex(data.products);
  const totals = new Map<string, ItemSales>();
  for (const l of soldSince(data, since)) {
    const name = productOf(l)?.name ?? l.name;
    const t = totals.get(name) ?? { name, quantity: 0, totalKobo: 0 };
    t.quantity += l.quantity;
    t.totalKobo += l.totalKobo;
    totals.set(name, t);
  }
  return [...totals.values()].sort((a, b) => b.totalKobo - a.totalKobo || b.quantity - a.quantity);
}

export interface Growth {
  best: ItemSales[];
  /** Products on the price list with no sale in 60 days. */
  slow: string[];
  /** Orders and counter sales on each weekday over 8 weeks, Monday first. */
  days: number[];
}

export function growth(data: AdvisorData, now: Date): Growth {
  const productOf = productIndex(data.products);
  const sold = new Set(soldSince(data, new Date(now.getTime() - SLOW_DAYS * DAY)).map((l) => productOf(l)?.id));
  const since = new Date(now.getTime() - BUSY_DAYS * DAY);
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const at of [...data.orders.map((o) => o.confirmedAt), ...data.counter.map((s) => s.at)]) {
    if (at < since) continue;
    // Lagos is UTC+1; getUTCDay counts from Sunday.
    days[(new Date(at.getTime() + 3_600_000).getUTCDay() + 6) % 7]!++;
  }
  return {
    best: bestSellers(data, new Date(now.getTime() - PERIOD_DAYS * DAY)),
    slow: data.products.filter((p) => p.active && p.options.some((o) => o.tiers.length) && !sold.has(p.id)).map((p) => p.name),
    days,
  };
}

// ---- 4. Check my prices ----

export interface PriceCheck {
  /** False when the shop's cost prices can't be read (counter sales off). */
  costsOn: boolean;
  /** Price list prices under the cost price. */
  belowCost: Array<{ name: string; fromQuantity: number; priceKobo: number; costKobo: number }>;
  /** Options with prices but no cost price entered. */
  noCost: number;
  /** What was actually sold under cost in the last 30 days. */
  soldBelowCost: Array<{ name: string; times: number; lossKobo: number }>;
  /** Bulk prices nobody bought enough to reach in 90 days. */
  unusedTiers: Array<{ name: string; fromQuantity: number; biggest: number }>;
}

export function priceCheck(data: AdvisorData, now: Date): PriceCheck {
  const options = data.products.filter((p) => p.active).flatMap((p) => p.options.filter((o) => o.tiers.length).map((o) => ({ p, o, name: `${p.name}: ${o.name}` })));
  const costsOn = options.some(({ o }) => o.costKobo !== undefined);
  const belowCost = options.flatMap(({ o, name }) =>
    o.costKobo == null ? [] : o.tiers.filter((t) => t.unitPriceKobo < o.costKobo!).map((t) => ({ name, fromQuantity: t.minQuantity, priceKobo: t.unitPriceKobo, costKobo: o.costKobo! })),
  );

  const losses = new Map<string, { name: string; times: number; lossKobo: number }>();
  for (const l of soldSince(data, new Date(now.getTime() - PERIOD_DAYS * DAY))) {
    if (l.unitCostKobo === null) continue;
    const loss = l.unitCostKobo * l.quantity - l.totalKobo;
    if (loss <= 0) continue;
    const t = losses.get(l.name) ?? { name: l.name, times: 0, lossKobo: 0 };
    t.times++;
    t.lossKobo += loss;
    losses.set(l.name, t);
  }

  const biggest = new Map<string, number>();
  for (const l of soldSince(data, new Date(now.getTime() - TIER_DAYS * DAY))) {
    for (const key of [l.variantId, l.name]) if (key) biggest.set(key, Math.max(biggest.get(key) ?? 0, l.quantity));
  }
  const unusedTiers = options.flatMap(({ o, name }) => {
    const most = Math.max((o.id && biggest.get(o.id)) || 0, biggest.get(name) ?? 0);
    const lowest = Math.min(...o.tiers.map((t) => t.minQuantity));
    const missed = o.tiers.filter((t) => t.minQuantity > lowest && t.minQuantity > most).sort((a, b) => a.minQuantity - b.minQuantity)[0];
    // Only for items people buy: one nobody buys is a slow item, not a pricing question.
    return most > 0 && missed ? [{ name, fromQuantity: missed.minQuantity, biggest: most }] : [];
  });

  return {
    costsOn,
    belowCost,
    noCost: costsOn ? options.filter(({ o }) => o.costKobo === null).length : 0,
    soldBelowCost: [...losses.values()].sort((a, b) => b.lossKobo - a.lossKobo),
    unusedTiers,
  };
}

// ---- 5. Write my status post or ad ----

export interface PostItem {
  name: string;
  /** The lowest price for one piece on the price list now. */
  fromKobo: number;
}

/**
 * The last 30 days' best sellers still on the price list, with their lowest
 * price; with no sales yet, the first items on the price list.
 */
export function postItems(data: AdvisorData, now: Date, limit = 3): { items: PostItem[]; fromSales: boolean } {
  const listed = data.products.filter((p) => p.active);
  const lowest = (name: string): PostItem[] => {
    const prices = (listed.find((p) => p.name === name)?.options ?? []).flatMap((o) => o.tiers.map((t) => t.unitPriceKobo));
    return prices.length ? [{ name, fromKobo: Math.min(...prices) }] : [];
  };
  const sold = bestSellers(data, new Date(now.getTime() - PERIOD_DAYS * DAY)).flatMap((s) => lowest(s.name)).slice(0, limit);
  return sold.length ? { items: sold, fromSales: true } : { items: listed.flatMap((p) => lowest(p.name)).slice(0, limit), fromSales: false };
}

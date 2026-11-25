import { formatMoney, parseMoney, type Currency } from "../../../core/money.js";
import type { HistoryEntry, Notice, Reply } from "../../../core/product.js";
import type { OutgoingTemplate } from "../../../core/whatsapp/client.js";
import { showWaId } from "../../../core/whatsapp/ids.js";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import type { PlanFeatures } from "../features.js";
import type { QuoteLine, Variant } from "../pricing.js";
import type { CatalogStore, OrderStore } from "../store.js";
import { hireCharge, settleReturn } from "./charges.js";
import { addDays, daysBetween, lagosToday, readHireDates, showDay, type Day, type HireDates } from "./dates.js";
import type { HirePapers } from "./papers.js";
import type { Booking, HireItem, NewBooking, Reminder, RentalStore } from "./store.js";

// Hire bookings for any business that hires things out by the day: equipment,
// cars, event chairs and canopies, halls, costumes (QUOTE_RENTALS, migration
// 0097), on the plans that include hire_bookings.
//
// 1. The owner marks price list rows as hire items ("hire 3 on"). The price
//    on the price list is the daily rate; "hire 3 units 2 deposit 50000 week
//    120000" says how many they own, the refundable deposit for one, and a
//    weekly rate.
// 2. A customer asks for an item with dates ("20kVA generator for 3 days
//    from Friday"). The dates are read in code, the item's free units on
//    those days are counted, and the quote is the hire charge for the days
//    plus the deposit, from the database. Delivery is asked after YES as for
//    any order.
// 3. YES holds the dates for HOLD_HOURS while the customer pays the pay
//    link (hire, deposit and delivery together). Payment books them. The
//    database never lets two customers take the same unit on the same day.
// 4. "out KP-1012" when it leaves; "back KP-1012 damage 15000 broken handle"
//    (typed or as a voice note) when it returns: late days and damage come
//    off the deposit, the customer is told what comes back, or gets a pay
//    link for the difference.
// 5. Customers are reminded the day before it goes out, the day before it's
//    due back, and once if it's late. The owner gets a morning summary:
//    going out, due back, overdue, out on hire, money in, deposits held.
//
// Owner commands: hire, hire 3 on/off, hire 3 units 2 deposit 50000 week
// 120000, free 27 Nov to 30 Nov, out KP-1012, back KP-1012 ..., bookings,
// agreement KP-1012, checklist KP-1012, stickers.

/** How long a YES holds the dates while the customer pays. */
export const HOLD_HOURS = 24;
/** How many days ahead to look for the next free dates when an item is booked. */
const LOOK_AHEAD_DAYS = 21;
/** Customer reminders go out in the daytime only, Lagos time. */
const FIRST_HOUR = 8;
const LAST_HOUR = 20;

export interface HireRequest {
  /** What the AI (or a button) said the customer wants: price list rows and how many. */
  items: Array<{ variantId: string; quantity: number }>;
  variants: Variant[];
  /** The customer's message and the chat before it, where the dates are read from. Left out for "order again". */
  text?: string;
  history?: HistoryEntry[];
}

export type HireQuote =
  /** Nothing asked for is a hire item. */
  | null
  /** Hire items asked for, but the dates are missing or nothing is free: this reply instead of a quote. */
  | { reply: string; rest: Array<{ variantId: string; quantity: number }> }
  | {
      lines: QuoteLine[];
      bookings: NewBooking[];
      /** "For Fri 27 Nov to Mon 30 Nov (3 days). Free on those dates." with any shortfalls. */
      note: string;
      /** The items that aren't for hire, priced as usual. */
      rest: Array<{ variantId: string; quantity: number }>;
    };

export interface BalanceCharge {
  /** e.g. "KP-1044" */
  label: string;
  /** A pay link for it, or null when the customer pays the business directly. */
  url: string | null;
}

export interface OwnerTools {
  /** Makes an order for what a customer owes after a return, with a pay link. */
  chargeBalance(customer: { contactId: string; waId: string; name: string | null }, line: QuoteLine): Promise<BalanceCharge | null>;
}

export interface HireBookings {
  /** Words for the AI next to a hire item, so it counts items, not days. */
  aiNote(variantId: string, items: Map<string, HireItem>): string | null;
  items(variantIds: string[]): Promise<Map<string, HireItem>>;
  quote(req: HireRequest): Promise<HireQuote>;
  saveQuote(orderId: string, bookings: NewBooking[]): Promise<void>;
  /** The customer said YES: holds the dates. Returns what to tell them when an item has gone meanwhile, else null. */
  hold(orderId: string, orderLabel: string): Promise<string | null>;
  /** The order was paid: books the dates. Lines for the customer and the owner, or null when nothing in it is on hire. */
  paid(orderId: string): Promise<{ customer: string; owner: string } | null>;
  ownerCommand(msg: IncomingMessage, tools: OwnerTools): Promise<Reply | null>;
  /** The owner's hire summary for today; null when nothing is on hire or coming up. */
  summary(now: Date): Promise<string | null>;
  /** Claims today's summary so it goes once a day. */
  claimSummary(now: Date): Promise<boolean>;
  /** Customer reminders due now, already claimed so they never go twice. */
  dueReminders(now: Date): Promise<Notice[]>;
}

export interface HireBookingsOptions {
  businessName: string;
  orderPrefix: string;
  store: RentalStore;
  catalog: CatalogStore;
  orders: Pick<OrderStore, "findOrder">;
  features?: PlanFeatures;
  currency?: Currency;
  /** Agreement, checklist and sticker PDFs. Without it, those commands aren't offered. */
  papers?: HirePapers;
  /**
   * Approved Utility template for hire messages sent outside the 24-hour window:
   * {{1}} business, {{2}} booking, {{3}} items, {{4}} the update.
   */
  template?: { name: string; language: string };
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const HIRE_LIST = /^(hire|hire items|rentals?|equipment)$/i;
const HIRE_SET = /^hire\s+(\d{1,3})\s+(.+)$/i;
const FREE = /^(?:free|available|availability|check)\s+(.+)$/i;
const BOOKINGS = /^(bookings|hire today|on hire|what'?s out)$/i;
const STICKERS = /^(stickers?|hire qr|qr stickers?)$/i;

/** The order number in "out KP-1012", "back kp 1012", "Back, KP-1012." or "back 1012". */
function orderNumberIn(text: string, prefix: string): { n: number; rest: string } | null {
  const re = new RegExp(`^(?:${prefix.replace(/[^a-z0-9]/gi, "")}\\s*[-–]?\\s*)?(\\d{3,9})\\b[.,:;]?`, "i");
  const m = text.trim().match(re);
  return m ? { n: Number(m[1]), rest: text.trim().slice(m[0].length).trim() } : null;
}

/** A damage charge in the returns check: "damage 15,000", "charge ₦15000", "15 thousand naira for the cable". */
export function damageIn(text: string): number | null {
  const m = text.match(/(?:damage[ds]?|charge|deduct|missing|broken)[^\d₦]{0,30}((?:₦|ngn|n)?\s*\d[\d,]*(?:\.\d{1,2})?)\s*(thousand)?/i);
  if (!m) return null;
  const kobo = parseMoney(m[1]!.trim());
  if (kobo === null) return null;
  return m[2] ? kobo * 1000 : kobo;
}

/** The returns check notes without the order number, the money and filler words. */
function returnNotes(text: string): string | null {
  const notes = text
    .replace(/\b(?:damage[ds]?|charge|deduct)\b\s*:?/gi, " ")
    .replace(/\bnaira\b/gi, " ")
    .replace(/(?:₦|ngn\b)?\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:thousand)?\s*(?:naira)?/gi, " ")
    .replace(/\s*([,.;])(?:\s*[,.;])+/g, "$1")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();
  return notes && !/^(ok|okay|fine|good|all good|no damage|clean)$/i.test(notes) ? notes.slice(0, 500) : null;
}

export function createHireBookings(opts: HireBookingsOptions): HireBookings {
  const now = () => (opts.now ? opts.now() : new Date());
  const money = (kobo: number) => formatMoney(kobo, opts.currency ?? "NGN");
  const ref = (n: number) => `${opts.orderPrefix}-${n}`;
  const log = opts.log ?? console;
  const onPlan = () => (opts.features ? opts.features.has("hire_bookings") : Promise.resolve(true));
  const dailyRate = (v: Variant) => [...v.tiers].sort((a, b) => a.minQuantity - b.minQuantity)[0]?.unitPriceKobo ?? null;
  const span = (start: Day, back: Day) => {
    const days = daysBetween(start, back);
    return `${showDay(start)} to ${showDay(back)} (${days} day${days === 1 ? "" : "s"})`;
  };
  const template = (b: Pick<Booking, "orderNumber">, items: string, update: string): OutgoingTemplate | undefined =>
    opts.template ? { ...opts.template, bodyParams: [opts.businessName, ref(b.orderNumber), items, update] } : undefined;

  /** Dates from the message, else from the customer's last few messages; a start in one and a length in another are put together. */
  function findDates(text: string | undefined, history: HistoryEntry[] | undefined): HireDates | null {
    const at = now();
    const said = [text ?? "", ...(history ?? []).filter((h) => h.direction === "inbound").map((h) => h.text).reverse().slice(0, 6)];
    let start: Day | null = null;
    let days: number | null = null;
    for (const words of said) {
      const d = readHireDates(words, at);
      if (!d) continue;
      if (d.start && d.back && !start && !days) return d;
      if (d.start && !start) start = d.start;
      if (d.start === null && !days) days = d.days;
      if (start && days) return { start, back: addDays(start, days) };
    }
    if (start) return { start, back: null };
    return days ? { start: null, days } : null;
  }

  /** The first start within LOOK_AHEAD_DAYS when `units` are free for the same number of days. */
  async function nextFree(variantId: string, units: number, owned: number, start: Day, days: number, orderId: string | null): Promise<Day | null> {
    for (let ahead = 1; ahead <= LOOK_AHEAD_DAYS; ahead++) {
      const from = addDays(start, ahead);
      if (owned - (await opts.store.taken(variantId, from, addDays(from, days), orderId)) >= units) return from;
    }
    return null;
  }

  const itemsSummary = (bookings: Booking[]) => bookings.map((b) => `${b.units} x ${b.name}`).join(", ");

  const hire: HireBookings = {
    aiNote(variantId, items) {
      return items.has(variantId) ? "For hire by the day: quantity is how many units, never the number of days." : null;
    },

    async items(variantIds) {
      if (!variantIds.length || !(await onPlan())) return new Map();
      return opts.store.items(variantIds);
    },

    async quote(req) {
      const items = await hire.items(req.items.map((i) => i.variantId));
      const wanted = req.items.filter((i) => items.has(i.variantId));
      if (!wanted.length) return null;
      const rest = req.items.filter((i) => !items.has(i.variantId));
      const byId = new Map(req.variants.map((v) => [v.id, v]));
      const names = wanted.map((i) => byId.get(i.variantId)?.name ?? "").filter(Boolean).join(", ");
      const dates = findDates(req.text, req.history);
      if (!dates) return { reply: `Which dates do you need the ${names}? For example "from Friday for 3 days" or "27 Nov to 30 Nov".`, rest };
      if (!dates.start) return { reply: `Which day should the ${names} start? For example "from Friday" or "from 27 Nov".`, rest };
      if (!dates.back) return { reply: `For how many days do you need the ${names} from ${showDay(dates.start)}? Or tell me the day it comes back.`, rest };
      const { start, back } = dates;
      const days = daysBetween(start, back);
      const lines: QuoteLine[] = [];
      const bookings: NewBooking[] = [];
      const problems: string[] = [];
      for (const want of wanted) {
        const variant = byId.get(want.variantId);
        const item = items.get(want.variantId)!;
        const daily = variant && dailyRate(variant);
        if (!variant || daily === null || daily === undefined) continue;
        const free = Math.max(item.units - (await opts.store.taken(variant.id, start, back, null)), 0);
        const units = Math.min(want.quantity, free);
        if (units < want.quantity) {
          const next = await nextFree(variant.id, want.quantity, item.units, start, days, null);
          problems.push(
            (free === 0 ? `Sorry, the ${variant.name} is booked on those dates.` : `Only ${free} ${variant.name} ${free === 1 ? "is" : "are"} free on those dates, so I've quoted ${free}.`) +
              (next ? ` ${want.quantity} ${want.quantity === 1 ? "is" : "are"} free from ${showDay(next)} for the same ${days} day${days === 1 ? "" : "s"}.` : ""),
          );
        }
        if (units === 0) continue;
        const rates = { dailyKobo: daily, weeklyKobo: item.weeklyKobo };
        const charge = hireCharge(days, rates);
        lines.push({ variantId: variant.id, name: `${variant.name} hire, ${span(start, back)}`, quantity: units, unitPriceKobo: charge, totalKobo: charge * units });
        if (item.depositKobo > 0) {
          lines.push({ variantId: variant.id, name: `Refundable deposit: ${variant.name}`, quantity: units, unitPriceKobo: item.depositKobo, totalKobo: item.depositKobo * units });
        }
        bookings.push({ variantId: variant.id, units, start, back, dailyKobo: daily, weeklyKobo: item.weeklyKobo, depositKobo: item.depositKobo });
      }
      if (!bookings.length) return { reply: problems.join("\n") || `Sorry, I couldn't price the ${names}. The team will get back to you.`, rest };
      const note = [`Out ${showDay(start)}, back ${showDay(back)}. Free on those dates.`, ...problems].join("\n");
      return { lines, bookings, note, rest };
    },

    saveQuote: (orderId, bookings) => opts.store.saveQuote(orderId, bookings),

    async hold(orderId, orderLabel) {
      const result = await opts.store.hold(orderId, HOLD_HOURS);
      if (result.ok) return null;
      const [booking] = (await opts.store.forOrder(orderId)).filter((b) => b.variantId === result.variantId);
      const what = booking ? `the ${booking.name} for ${span(booking.start, booking.back)}` : "an item on it";
      return `Sorry, ${what} was just booked by someone else${result.free ? `, and only ${result.free} ${result.free === 1 ? "is" : "are"} free now` : ""}, so I can't confirm ${orderLabel}. Send me other dates, or fewer, and I'll check again.`;
    },

    async paid(orderId) {
      const booked = await opts.store.move(orderId, ["quoted", "held"], "booked");
      if (!booked.length) return null;
      const items = await opts.store.items(booked.map((b) => b.variantId));
      const clashes: string[] = [];
      for (const b of booked) {
        const owned = items.get(b.variantId)?.units ?? 0;
        if ((await opts.store.taken(b.variantId, b.start, b.back, orderId)) + b.units > owned) clashes.push(b.name);
      }
      const when = booked.map((b) => `• ${b.units} x ${b.name}: ${span(b.start, b.back)}`).join("\n");
      return {
        customer: `Your hire is booked:\n${when}\nWe'll remind you the day before. Your deposit comes back when everything is returned in good condition.`,
        owner:
          `Hire booked:\n${when}\nSend *out ${ref(booked[0]!.orderNumber)}* when it leaves.` +
          (clashes.length ? `\n\n⚠️ Paid after the 24-hour hold ran out, and ${clashes.join(", ")} is now double booked on some of those days. Please sort it with one of the customers.` : ""),
      };
    },

    async ownerCommand(msg, tools) {
      const text = (msg.text ?? "").trim().replace(/[.!]+$/, "");
      // Each of these names a booking number, so "back in stock" or "out of stock" aren't taken for them.
      const out = text.match(/^(?:out|gone out|delivered|collected)\b[\s,:-]*(.*\d{3,}.*)$/i);
      const back = text.match(/^(?:back|returned|return)\b[\s,:-]*(.*\d{3,}.*)$/i);
      const paper = text.match(/^(agreement|checklist|papers)\b[\s,:-]*(.*\d{3,}.*)$/i);
      const isHire = HIRE_LIST.test(text) || HIRE_SET.test(text) || FREE.test(text) || BOOKINGS.test(text) || (STICKERS.test(text) && !!opts.papers) || out || back || paper;
      if (!isHire) return null;
      if (!(await onPlan())) return { text: "Hire bookings come with Pro and above. Send *plan* to see how to upgrade." };
      if (HIRE_LIST.test(text)) return { text: await hireList() };
      const set = text.match(HIRE_SET);
      if (set) return { text: await setHire(Number(set[1]), set[2]!) };
      const free = text.match(FREE);
      if (free) return { text: await freeOn(free[1]!) };
      if (BOOKINGS.test(text)) return { text: (await hire.summary(now())) ?? "Nothing is on hire or booked right now." };
      if (STICKERS.test(text)) return { text: `Stickers for each hire item, with a QR code customers scan to book it on WhatsApp:\n${opts.papers!.stickersLink()}\n\nPrint on A4 sticker paper and put one on each item.` };
      if (out) return { text: await goneOut(out[1]!) };
      if (back) return returnsCheck(back[1]!, tools);
      if (paper) return { text: await papersFor(paper[2]!, paper[1]!.toLowerCase()) };
      return null;
    },

    async summary(at) {
      const today = lagosToday(at);
      const tomorrow = addDays(today, 1);
      const active = await opts.store.active();
      const going = active.filter((b) => b.status !== "out" && b.start === today);
      const dueToday = active.filter((b) => b.status === "out" && b.back === today);
      const overdue = active.filter((b) => b.status === "out" && b.back < today);
      const outNow = active.filter((b) => b.status === "out" && b.back > today);
      const notCollected = active.filter((b) => b.status === "booked" && b.start < today);
      const held = active.filter((b) => b.status === "held");
      const dueTomorrow = active.filter((b) => b.status === "out" && b.back === tomorrow);
      const yesterday = new Date(Date.parse(`${addDays(today, -1)}T00:00:00+01:00`));
      const paid = await opts.store.paidBetween(yesterday, new Date(Date.parse(`${today}T00:00:00+01:00`)));
      if (!active.length && !paid.orders) return null;
      const who = (b: Booking) => `${b.customerName ?? "customer"} ${showWaId(b.customerWaId)}`;
      const line = (b: Booking, end: string) => `• ${ref(b.orderNumber)} ${b.units} x ${b.name}, ${who(b)}${end}`;
      const part = (title: string, list: Booking[], end: (b: Booking) => string) =>
        list.length ? [`*${title} (${list.length})*`, ...list.slice(0, 10).map((b) => line(b, end(b))), ...(list.length > 10 ? [`…and ${list.length - 10} more`] : []), ""] : [];
      const deposits = active.filter((b) => b.status === "booked" || b.status === "out").reduce((sum, b) => sum + b.depositKobo * b.units, 0);
      return [
        `*${opts.businessName} hire, ${showDay(today)}*`,
        "",
        ...part("Overdue", overdue, (b) => `, ${daysBetween(b.back, today)} day${daysBetween(b.back, today) === 1 ? "" : "s"} late (due ${showDay(b.back)})`),
        ...part("Going out today", going, (b) => `, back ${showDay(b.back)}${b.status === "held" ? ", not paid yet" : ""}`),
        ...part("Due back today", dueToday, () => ""),
        ...part("Booked but not sent out", notCollected, (b) => `, was due out ${showDay(b.start)}`),
        ...part("Due back tomorrow", dueTomorrow, () => ""),
        ...part("Out on hire", outNow, (b) => `, back ${showDay(b.back)}`),
        ...(held.length ? [`Waiting for payment: ${held.length} booking${held.length === 1 ? "" : "s"} held for 24 hours.`] : []),
        `Money in yesterday: ${money(paid.kobo)}${paid.orders ? ` from ${paid.orders} hire order${paid.orders === 1 ? "" : "s"}` : ""}.`,
        `Deposits you're holding: ${money(deposits)}.`,
        "",
        "Send *out KP-1012* when something leaves and *back KP-1012* when it returns (a voice note works too).".replaceAll("KP", opts.orderPrefix),
      ].join("\n");
    },

    async claimSummary(at) {
      return opts.store.claimSummary(lagosToday(at));
    },

    async dueReminders(at) {
      const hour = (at.getUTCHours() + 1) % 24;
      if (hour < FIRST_HOUR || hour >= LAST_HOUR || !(await onPlan())) return [];
      const today = lagosToday(at);
      const tomorrow = addDays(today, 1);
      const due = new Map<string, { kind: Reminder; list: Booking[] }>();
      for (const b of await opts.store.active()) {
        const kind: Reminder | null =
          b.status === "booked" && b.start === tomorrow && !b.startRemindedAt
            ? "start"
            : (b.status === "out" || b.status === "booked") && b.back === tomorrow && b.start < tomorrow && !b.returnRemindedAt
              ? "return"
              : b.status === "out" && b.back < today && !b.overdueRemindedAt
                ? "overdue"
                : null;
        if (!kind) continue;
        const key = `${b.orderId}:${kind}`;
        const group = due.get(key) ?? { kind, list: [] };
        group.list.push(b);
        due.set(key, group);
      }
      const notices: Notice[] = [];
      for (const { kind, list } of due.values()) {
        const claimed: Booking[] = [];
        for (const b of list) if (await opts.store.claimReminder(b.id, kind)) claimed.push(b);
        if (!claimed.length) continue;
        const first = claimed[0]!;
        const items = itemsSummary(claimed);
        const update =
          kind === "start"
            ? `it starts tomorrow, ${showDay(first.start)}.`
            : kind === "return"
              ? `it is due back tomorrow, ${showDay(first.back)}.`
              : `it was due back on ${showDay(first.back)}. Late days are charged at ${money(first.dailyKobo)} a day.`;
        const text =
          kind === "start"
            ? `Reminder from ${opts.businessName}: your hire of ${items} (${ref(first.orderNumber)}) starts tomorrow, ${showDay(first.start)}. Reply here if anything has changed.`
            : kind === "return"
              ? `Reminder from ${opts.businessName}: ${items} (${ref(first.orderNumber)}) is due back tomorrow, ${showDay(first.back)}. Need more days? Reply here and we'll check.`
              : `Hello from ${opts.businessName}: ${items} (${ref(first.orderNumber)}) was due back on ${showDay(first.back)}. Late days are charged at ${money(first.dailyKobo)} a day from the deposit. Please return it, or reply here if you need more days.`;
        const tpl = template(first, items, update);
        notices.push({ to: first.customerWaId, text, ...(tpl ? { template: tpl } : {}) });
      }
      return notices;
    },
  };
  return hire;

  async function rows(): Promise<Variant[]> {
    return [...(await opts.catalog.activeVariants())].sort((a, b) => a.name.localeCompare(b.name));
  }

  async function hireList(): Promise<string> {
    const list = await rows();
    if (!list.length) return "Your price list is empty. Add the things you hire out first, with the daily rate as the price.";
    const items = await opts.store.items(list.map((v) => v.id));
    const lines = list.slice(0, 60).map((v, i) => {
      const item = items.get(v.id);
      const daily = dailyRate(v);
      if (!item) return `${i + 1}. ${v.name}`;
      const extras = [`${item.units} owned`, `${daily === null ? "no price" : money(daily)} a day`, ...(item.weeklyKobo !== null ? [`${money(item.weeklyKobo)} a week`] : []), `deposit ${money(item.depositKobo)}`];
      return `${i + 1}. ✅ ${v.name}: ${extras.join(", ")}`;
    });
    return [
      "*Hire items* (✅ = for hire)",
      ...lines,
      "",
      "The price on your price list is the daily rate.",
      "• *hire 3 on* makes item 3 a hire item, *hire 3 off* stops it",
      "• *hire 3 units 2 deposit 50000 week 120000* sets how many you own, the deposit for one and a weekly rate (*week off* removes it)",
      "• *free 27 Nov to 30 Nov* shows what's free",
      "• *bookings* shows what's out and due back",
      ...(opts.papers ? ["• *agreement KP-1012* and *checklist KP-1012* make the hire agreement and the delivery and return checklist to print", "• *stickers* makes a QR sticker for each item"] : []),
    ]
      .join("\n")
      .replaceAll("KP-", `${opts.orderPrefix}-`);
  }

  async function setHire(n: number, words: string): Promise<string> {
    const list = await rows();
    const variant = list[n - 1];
    if (!variant) return `There's no item ${n}. Send *hire* to see the numbers.`;
    const w = words.trim().toLowerCase();
    if (w === "off") {
      await opts.store.removeItem(variant.id);
      return `${variant.name} is no longer for hire. Bookings already made stay as they are.`;
    }
    const change: Partial<Omit<HireItem, "variantId">> = {};
    if (w !== "on") {
      const parts = [...w.matchAll(/(units?|owned|deposit|week(?:ly)?)\s*[:=]?\s*((?:₦\s*)?\S+)/g)];
      if (!parts.length) return `I didn't follow. Try *hire ${n} on* or *hire ${n} units 2 deposit 50000 week 120000*.`;
      for (const [, key, value] of parts) {
        const k = key!;
        const v = value!.trim();
        if (k.startsWith("unit") || k === "owned") {
          const units = Number(v.replace(/,/g, ""));
          if (!Number.isSafeInteger(units) || units < 1 || units > 10000) return "Units must be a whole number from 1.";
          change.units = units;
        } else if (k === "deposit") {
          const kobo = v === "off" || v === "none" ? 0 : parseMoney(v, opts.currency);
          if (kobo === null) return `I couldn't read the deposit "${v}". Write it in full, e.g. 50000.`;
          change.depositKobo = kobo;
        } else {
          const kobo = v === "off" || v === "none" ? null : parseMoney(v, opts.currency);
          if (kobo === undefined || (kobo === null && v !== "off" && v !== "none")) return `I couldn't read the weekly rate "${v}". Write it in full, e.g. 120000.`;
          change.weeklyKobo = kobo;
        }
      }
    }
    const item = await opts.store.setItem(variant.id, change);
    const daily = dailyRate(variant);
    return [
      `✅ ${variant.name} is for hire.`,
      `• ${item.units} owned`,
      `• ${daily === null ? "No price on your price list yet: add one, it's the daily rate" : `${money(daily)} a day (from your price list)`}`,
      `• Weekly rate: ${item.weeklyKobo === null ? "none, every day at the daily rate" : money(item.weeklyKobo)}`,
      `• Deposit: ${money(item.depositKobo)} for each one`,
    ].join("\n");
  }

  async function freeOn(words: string): Promise<string> {
    const dates = readHireDates(words, now());
    if (!dates?.start || !dates.back) return "Tell me the dates, e.g. *free 27 Nov to 30 Nov* or *free Friday for 3 days*.";
    const list = await rows();
    const items = await opts.store.items(list.map((v) => v.id));
    const hired = list.filter((v) => items.has(v.id));
    if (!hired.length) return "No hire items yet. Send *hire* to set them up.";
    const lines: string[] = [];
    for (const v of hired) {
      const owned = items.get(v.id)!.units;
      const free = Math.max(owned - (await opts.store.taken(v.id, dates.start, dates.back, null)), 0);
      lines.push(`• ${v.name}: ${free} of ${owned} free`);
    }
    return [`*Free ${span(dates.start, dates.back)}*`, ...lines].join("\n");
  }

  async function bookingsFor(words: string): Promise<{ bookings: Booking[]; label: string; rest: string } | string> {
    const found = orderNumberIn(words, opts.orderPrefix);
    if (!found) return `Which booking? For example *${opts.orderPrefix}-1012*.`;
    const order = await opts.orders.findOrder(found.n);
    if (!order) return `I can't find ${ref(found.n)}.`;
    const bookings = await opts.store.forOrder(order.id);
    if (!bookings.length) return `${ref(found.n)} has nothing on hire.`;
    return { bookings, label: ref(found.n), rest: found.rest };
  }

  async function goneOut(words: string): Promise<string> {
    const found = await bookingsFor(words);
    if (typeof found === "string") return found;
    const { bookings, label } = found;
    if (bookings.every((b) => b.status === "out")) return `${label} is already out.`;
    if (bookings.every((b) => b.status === "quoted")) return `${label} isn't confirmed yet: the customer hasn't said YES.`;
    const moved = await opts.store.move(bookings[0]!.orderId, ["held", "booked"], "out");
    if (!moved.length) return `${label} can't go out now (it's ${bookings[0]!.status}).`;
    const unpaid = bookings.some((b) => b.status === "held");
    return [
      `${label} is out: ${moved.map((b) => `${b.units} x ${b.name}`).join(", ")}, due back ${showDay(moved[0]!.back)}.`,
      ...(unpaid ? ["⚠️ It wasn't paid yet. Send *paid " + label + "* when it is."] : []),
      `When it comes back, send *back ${label}* with any damage, e.g. *back ${label} damage 15000 broken handle*. A voice note works too.`,
    ].join("\n");
  }

  async function returnsCheck(words: string, tools: OwnerTools): Promise<Reply> {
    const found = await bookingsFor(words);
    if (typeof found === "string") return { text: found };
    const { bookings, label, rest } = found;
    const open = bookings.filter((b) => b.status === "out" || b.status === "booked" || b.status === "held");
    if (!open.length) return { text: bookings.some((b) => b.status === "returned") ? `${label} was already checked back in.` : `${label} isn't out on hire.` };
    const today = lagosToday(now());
    const damageKobo = damageIn(rest) ?? 0;
    const notes = returnNotes(rest);
    let lateKobo = 0;
    let depositKobo = 0;
    let lateDays = 0;
    for (const [i, b] of open.entries()) {
      lateDays = Math.max(daysBetween(b.back, today), 0);
      const s = settleReturn({ depositKobo: 0, lateDays, units: b.units, rates: { dailyKobo: b.dailyKobo, weeklyKobo: b.weeklyKobo }, damageKobo: i === 0 ? damageKobo : 0 });
      lateKobo += s.lateKobo;
      depositKobo += b.depositKobo * b.units;
      await opts.store.returned(b.id, { lateKobo: s.lateKobo, damageKobo: s.damageKobo, notes: i === 0 ? notes : null });
    }
    const owed = lateKobo + damageKobo;
    const refundKobo = Math.max(depositKobo - owed, 0);
    const balanceKobo = Math.max(owed - depositKobo, 0);
    const first = open[0]!;
    const items = itemsSummary(open);
    const sums = [
      `Deposit paid: ${money(depositKobo)}`,
      ...(lateKobo ? [`Late return, ${lateDays} day${lateDays === 1 ? "" : "s"}: -${money(lateKobo)}`] : []),
      ...(damageKobo ? [`Damage or missing parts${notes ? ` (${notes})` : ""}: -${money(damageKobo)}`] : []),
    ];
    let balance: BalanceCharge | null = null;
    if (balanceKobo > 0) {
      try {
        balance = await tools.chargeBalance(
          { contactId: first.contactId, waId: first.customerWaId, name: first.customerName },
          { variantId: first.variantId, name: `Balance after hire ${label}`, quantity: 1, unitPriceKobo: balanceKobo, totalKobo: balanceKobo },
        );
      } catch (err) {
        log.error(`Couldn't make the balance order for ${label}:`, err);
      }
    }
    const customerEnd = balanceKobo
      ? `The deposit doesn't cover it, so ${money(balanceKobo)} is still to pay${balance ? ` (${balance.label})` : ""}.${balance?.url ? `\nPay here: ${balance.url}` : ""}`
      : refundKobo
        ? `We'll send ${money(refundKobo)} of your deposit back to you.`
        : "Your deposit covers it, so nothing more is due.";
    const customerText = `Thank you for returning ${items} (${label}) to ${opts.businessName}.\n${sums.join("\n")}\n${customerEnd}`;
    const tpl = template(first, items, balanceKobo ? `it has been checked back in. ${money(balanceKobo)} is still to pay.` : `it has been checked back in. ${money(refundKobo)} of your deposit comes back to you.`);
    const ownerEnd = balanceKobo
      ? `${money(balanceKobo)} is still owed${balance ? `: ${balance.label}${balance.url ? ", pay link sent" : ""}` : ""}.`
      : refundKobo
        ? `👉 Refund ${money(refundKobo)} to ${first.customerName ?? "the customer"} (${showWaId(first.customerWaId)}).`
        : "Nothing to refund.";
    return {
      text: [`✅ ${label} checked back in: ${items}.`, ...sums, ownerEnd, "", "I've sent the customer the same breakdown."].join("\n"),
      notify: [{ to: first.customerWaId, text: customerText, ...(tpl ? { template: tpl } : {}) }],
    };
  }

  async function papersFor(words: string, kind: string): Promise<string> {
    if (!opts.papers) return "Hire papers aren't switched on yet.";
    const found = await bookingsFor(words);
    if (typeof found === "string") return found;
    const order = found.bookings[0]!;
    const links = [
      ...(kind !== "checklist" ? [`Hire agreement: ${opts.papers.agreementLink(order.orderId)}`] : []),
      ...(kind !== "agreement" ? [`Delivery and return checklist: ${opts.papers.checklistLink(order.orderId)}`] : []),
    ];
    return `${found.label}, ready to print:\n${links.join("\n")}\n\nThe customer signs the agreement when it goes out; fill in the checklist at delivery and again at return.`;
  }
}

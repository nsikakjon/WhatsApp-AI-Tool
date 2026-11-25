import { formatMoney, parseMoney, type Currency } from "../../../core/money.js";
import type { Notice, Reply } from "../../../core/product.js";
import type { OutgoingList, OutgoingTemplate } from "../../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import { priceFacts } from "../catalogue.js";
import type { PlanFeatures } from "../features.js";
import type { QuoteLine, Variant } from "../pricing.js";
import { canDo, openDays, slotsOn, type Calendar, type Slot, type SlotInput } from "./slots.js";
import type { Appointment, AppointmentStore, BookingService, Payment } from "./store.js";
import { atLagos, lagos, readDay, readHours, readTime, readWeekdays, showDay, showTime, showWeekdays, showWhen, type Day } from "./times.js";

// Appointment booking (QUOTE_APPOINTMENTS, migration 0099), on the plans that
// include "appointments" (Pro and up). For gyms, clinics, salons, tutors and
// coaches.
//
// Customers send "book" (or ask the AI for a service the owner made
// bookable) and tap through lists: the service, who they'd like to see (or
// the first free), a day, a time. Prices always come from the price list.
// Each service either takes the full price or a deposit through a pay link
// (the time is held for 30 minutes while they pay), or books free and is
// paid at the visit. "my bookings" lists theirs, with Cancel and Change time
// up to the owner's cut-off. Reminders go the day before and 2 hours before.
//
// The owner sets it up on WhatsApp: "book 3 60min" makes price list row 3 a
// one-to-one session, "book 3 45min class 20" a group class with 20 places,
// "calendar add Dr Ada" and "calendar 1 Mon-Fri 9-5" set who sees customers
// and when, "class 3 Mon Wed Fri 7am" sets a class's times. "bookings" shows
// the day; a summary comes at 7am.

const HOLD_MINUTES = 30;
/** A hold not paid for this long after it ran out is let go (with its unpaid order). */
const RELEASE_GRACE_MS = 30 * 60_000;
/** WhatsApp lists take 10 rows. */
const ROWS = 10;
const TAP = "BK";

export interface Checkout {
  /** Makes a confirmed order for this line and its pay link (null when payments are off or held). */
  (customer: { contactId: string; waId: string }, line: QuoteLine): Promise<{ orderId: string; label: string; url: string | null }>;
}

export interface CustomerContext {
  contactId: string;
  waId: string;
  name: string | null;
  checkout: Checkout;
}

export interface Appointments {
  /** "book", "my bookings" and taps on the booking lists; null for anything else. */
  customerMessage(msg: IncomingMessage, ctx: CustomerContext): Promise<Reply | null>;
  /** When the AI picked a bookable service to quote, the booking lists for it instead. */
  forQuote(variantIds: string[], variants: Variant[]): Promise<Reply | null>;
  ownerCommand(msg: IncomingMessage): Promise<Reply | null>;
  /** Books what a paid order held. Lines for the customer's receipt and the owner's alert, or null. */
  paid(orderId: string): Promise<{ customer: string; owner: string } | null>;
  /** Reminders that are due, and notes to customers whose unpaid hold was let go. */
  due(at: Date): Promise<Notice[]>;
  /** The owner's 7am list of today's bookings, or null when there are none. */
  summary(at: Date): Promise<string | null>;
  claimSummary(at: Date): Promise<boolean>;
}

export interface AppointmentOptions {
  businessName: string;
  store: AppointmentStore;
  catalog: { activeVariants(): Promise<Variant[]> };
  features?: PlanFeatures;
  currency?: Currency;
  ownerWaId?: string;
  /** APPOINTMENT_REMINDER_TEMPLATE_NAME: reaches customers outside WhatsApp's 24-hour window. */
  template?: { name: string; language: string };
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const MINE = /^(?:(?:see|show|check|cancel|change)\s+)?(?:my|our)\s+(?:bookings?|appointments?|sessions?|classes)[.!?]*$|^(?:cancel|change|reschedule|move)\s+(?:a|my|the)\s+(?:booking|appointment|session|class)[.!?]*$|^reschedule[.!?]*$/i;
const BOOK = /^(?:(?:hi|hello|good (?:morning|afternoon|evening))[,!. ]+)?(?:(?:i\s+)?(?:want|wan|would like|'d like|need)\s+(?:to\s+)?|(?:can|could|may)\s+i\s+|pls\s+|please\s+)?(?:book|make an? (?:appointment|booking|reservation)|schedule an? (?:appointment|session|visit|class)|reserve an? (?:spot|place|slot))\b|^(?:appointments?|bookings?|book now)[.!?]*$/i;

export function createAppointments(opts: AppointmentOptions): Appointments {
  const now = () => (opts.now ? opts.now() : new Date());
  const log = opts.log ?? console;
  const money = (kobo: number) => formatMoney(kobo, opts.currency ?? "NGN");
  const onPlan = () => (opts.features ? opts.features.has("appointments") : Promise.resolve(true));
  const ref = (a: Pick<Appointment, "number">) => `B${a.number}`;
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const short = (variant: Variant) => variant.name.replace(/: Standard$/i, "");

  async function slotInput(service: BookingService): Promise<SlotInput> {
    const at = now();
    const rules = await opts.store.rules();
    const until = new Date(at.getTime() + (rules.daysAhead + 2) * 86_400_000);
    const [calendars, classTimes, blocks, busy] = await Promise.all([
      opts.store.calendars(),
      opts.store.classTimes(),
      opts.store.blocks(at),
      opts.store.busy(at, until),
    ]);
    return { service, calendars, classTimes, blocks, busy, rules, now: at };
  }

  async function bookable(): Promise<{ services: Map<string, BookingService>; variants: Variant[] }> {
    const [services, all] = await Promise.all([opts.store.services(), opts.catalog.activeVariants()]);
    const variants = all.filter((v) => services.has(v.id)).sort((a, b) => a.name.localeCompare(b.name));
    return { services, variants };
  }

  function about(variant: Variant, service: BookingService): string {
    const facts = priceFacts(variant);
    const price = facts ? money(facts.unitKobo) : "price on request";
    return `${service.places > 1 ? "Class · " : ""}${service.minutes} min · ${price}`;
  }

  /** Tap ids: "BK d <variant> <calendar|any> <day> [<from minute>] [m<booking number>]". */
  function tap(kind: string, ...parts: Array<string | number | null | undefined>): string {
    return [TAP, kind, ...parts.filter((p) => p !== null && p !== undefined && p !== "")].join(" ");
  }

  // Customer steps -----------------------------------------------------------

  async function chooseService(): Promise<Reply> {
    const { services, variants } = await bookable();
    if (variants.length === 1) return choosePerson(variants[0]!, services.get(variants[0]!.id)!, null);
    if (!variants.length) return { text: "Sorry, there's nothing to book right now." };
    const rows = variants.slice(0, ROWS).map((v) => ({ id: tap("s", v.id), title: cut(short(v), 24), description: cut(about(v, services.get(v.id)!), 72) }));
    return { text: "", list: { body: `What would you like to book at ${opts.businessName}?`, button: "Pick a service", rows } };
  }

  async function choosePerson(variant: Variant, service: BookingService, move: Appointment | null): Promise<Reply> {
    if (service.places > 1 || move) return chooseDay(variant, service, move ? move.calendarId : null, move);
    const able = (await opts.store.calendars()).filter((c) => canDo(c, variant.id) && c.hours.size > 0);
    if (able.length <= 1) return chooseDay(variant, service, able[0]?.id ?? null, null);
    const rows = [
      { id: tap("p", variant.id, "any"), title: "First free", description: "Whoever is free at the time you pick" },
      ...able.slice(0, ROWS - 1).map((c) => ({ id: tap("p", variant.id, c.id), title: cut(c.name, 24) })),
    ];
    return { text: "", list: { body: `*${short(variant)}* (${about(variant, service)})\n\nWho would you like to see?`, button: "Pick a person", rows } };
  }

  async function chooseDay(variant: Variant, service: BookingService, calendarId: string | null, move: Appointment | null): Promise<Reply> {
    const input = await slotInput(service);
    const days = openDays(input, ROWS, service.places > 1 ? null : calendarId);
    const who = calendarId ? input.calendars.find((c) => c.id === calendarId)?.name : null;
    if (!days.length) {
      return { text: `Sorry, there are no free times for ${short(variant)}${who ? ` with ${who}` : ""} in the next ${input.rules.daysAhead} days. Please message us and we'll find you a time.` };
    }
    const m = move ? `m${move.number}` : null;
    const rows = days.map(({ day, count }) => {
      const only = count === 1 ? slotsOn(input, day, service.places > 1 ? null : calendarId)[0] : undefined;
      const description = only
        ? `${showTime(lagos(only.start).minute)}${only.left !== null ? ` · ${only.left} ${only.left === 1 ? "place" : "places"} left` : ""}`
        : `${count} free times`;
      return { id: tap("d", variant.id, calendarId ?? "any", day, 0, m), title: showDay(day), description };
    });
    const head = move ? `Pick a new day for ${ref(move)}, *${short(variant)}*` : `*${short(variant)}*${who ? ` with ${who}` : ""}`;
    return { text: "", list: { body: `${head}\n\nWhich day suits you?`, button: "Pick a day", rows } };
  }

  async function chooseTime(variant: Variant, service: BookingService, calendarId: string | null, day: Day, from: number, move: Appointment | null): Promise<Reply> {
    const input = await slotInput(service);
    const slots = slotsOn(input, day, service.places > 1 ? null : calendarId).filter((s) => lagos(s.start).minute >= from);
    if (!slots.length) return chooseDay(variant, service, calendarId, move);
    const m = move ? `m${move.number}` : null;
    const more = slots.length > ROWS;
    const shown = slots.slice(0, more ? ROWS - 1 : ROWS);
    const rows: OutgoingList["rows"] = shown.map((s) => ({
      id: tap("t", variant.id, calendarId ?? "any", s.start.toISOString().slice(0, 16), m),
      title: showTime(lagos(s.start).minute),
      description: slotNote(s, calendarId),
    }));
    if (more) rows.push({ id: tap("d", variant.id, calendarId ?? "any", day, lagos(slots[ROWS - 1]!.start).minute, m), title: "Later times", description: `After ${showTime(lagos(shown[shown.length - 1]!.start).minute)}` });
    return { text: "", list: { body: `*${short(variant)}*, ${showDay(day)}\n\nWhat time?`, button: "Pick a time", rows } };
  }

  function slotNote(s: Slot, calendarId: string | null): string | undefined {
    const parts = [
      ...(s.left !== null ? [`${s.left} ${s.left === 1 ? "place" : "places"} left`] : []),
      ...(!calendarId && s.calendars[0] ? [`with ${s.calendars[0].name}`] : []),
    ];
    return parts.length ? parts.join(" · ") : undefined;
  }

  /** Holds or books the time tapped, and takes payment when the service needs it. */
  async function takeTime(variant: Variant, service: BookingService, calendarId: string | null, start: Date, move: Appointment | null, ctx: CustomerContext): Promise<Reply> {
    const day = lagos(start).day;
    const input = await slotInput(service);
    const slot = slotsOn(input, day, service.places > 1 ? null : calendarId).find((s) => s.start.getTime() === start.getTime());
    const taken = async () => {
      const again = await chooseTime(variant, service, calendarId, day, 0, move);
      return { ...again, text: "Sorry, that time has just gone. Here's what's still free:" };
    };
    if (!slot) return taken();

    const facts = priceFacts(variant);
    const price = facts?.unitKobo ?? 0;
    const payNow = move || !facts ? 0 : payNowFor(service, price);
    // A class's person comes from its timetable; one-to-one tries each free person in turn.
    const candidates = service.places > 1 ? [slot.calendars[0]?.id ?? null] : slot.calendars.map((c) => c.id);
    let placed: string | null = null;
    let calendar: string | null = null;
    for (const id of candidates) {
      placed = await opts.store.place({
        variantId: variant.id,
        calendarId: id,
        start: slot.start,
        end: slot.end,
        waId: ctx.waId,
        name: ctx.name,
        contactId: ctx.contactId,
        places: 1,
        status: payNow > 0 ? "held" : "booked",
        holdMinutes: HOLD_MINUTES,
        priceKobo: price,
        payNowKobo: payNow,
        move: move?.id ?? null,
      });
      if (placed) {
        calendar = id;
        break;
      }
    }
    if (!placed) return taken();
    const booking = (await opts.store.byId(placed))!;
    const who = calendar ? input.calendars.find((c) => c.id === calendar)?.name ?? null : null;
    const what = `*${short(variant)}*, ${showWhen(slot.start)}${who ? ` with ${who}` : ""}`;

    if (move) {
      return {
        text: `Done: ${ref(booking)} is now ${what}. See you then!`,
        notify: toOwner(`${ref(booking)} moved by ${ctx.name ?? "the customer"} (${ctx.waId}): ${short(variant)}, now ${showWhen(slot.start)}${who ? ` with ${who}` : ""} (was ${showWhen(move.start)}).`),
      };
    }

    if (payNow > 0) {
      const line: QuoteLine = {
        variantId: variant.id,
        name: `${service.payment === "deposit" ? "Deposit: " : ""}${short(variant)}, ${showWhen(slot.start)}`,
        quantity: 1,
        unitPriceKobo: payNow,
        totalKobo: payNow,
      };
      const order = await ctx.checkout({ contactId: ctx.contactId, waId: ctx.waId }, line);
      await opts.store.setOrder(booking.id, order.orderId);
      if (order.url) {
        const rest = price - payNow;
        return {
          text: [
            `I'm holding ${what} for you for ${HOLD_MINUTES} minutes (${ref(booking)}).`,
            "",
            `Pay ${money(payNow)}${service.payment === "deposit" ? " deposit" : ""} here to book it: ${order.url}`,
            ...(rest > 0 ? ["", `The other ${money(rest)} is paid at your visit.`] : []),
          ].join("\n"),
        };
      }
      // No pay link (payments off or paused): booked now, paid to the business directly.
      await opts.store.book(booking.id, true);
      return booked(booking, variant, what, who, ctx, {
        customer: `Please pay ${money(payNow)} to ${opts.businessName} to keep it (order ${order.label}).`,
        owner: `They'll pay you ${money(payNow)} directly (order ${order.label}, no pay link).`,
      });
    }
    const pay = !facts
      ? { customer: "We'll confirm the price with you.", owner: "No price on the price list: confirm it with them." }
      : price > 0
        ? { customer: `You pay ${money(price)} at your visit.`, owner: `They pay ${money(price)} at the visit.` }
        : null;
    return booked(booking, variant, what, who, ctx, pay);
  }

  function payNowFor(service: BookingService, price: number): number {
    if (service.payment === "full") return price;
    if (service.payment === "deposit") return Math.min(service.depositKobo, price);
    return 0;
  }

  function booked(booking: Appointment, variant: Variant, what: string, who: string | null, ctx: CustomerContext, pay: { customer: string; owner: string } | null): Reply {
    return {
      text: [`You're booked ✅ ${what} (${ref(booking)}).`, ...(pay ? ["", pay.customer] : []), "", "I'll remind you the day before. Send *my bookings* to cancel or change it."].join("\n"),
      notify: toOwner(`New booking ${ref(booking)}: ${short(variant)}, ${showWhen(booking.start)}${who ? ` with ${who}` : ""}, ${ctx.name ?? "a customer"} (${ctx.waId}).${pay ? ` ${pay.owner}` : ""}`),
    };
  }

  function toOwner(text: string): Notice[] {
    return opts.ownerWaId ? [{ to: opts.ownerWaId, text }] : [];
  }

  async function myBookings(waId: string): Promise<Reply> {
    const mine = await opts.store.upcomingFor(waId, now());
    if (!mine.length) return { text: "You have no upcoming bookings. Send *book* to make one." };
    const names = await variantNames();
    if (mine.length === 1) return bookingCard(mine[0]!, names);
    return {
      text: "",
      list: {
        body: "Your upcoming bookings. Tap one to cancel or change it.",
        button: "My bookings",
        rows: mine.map((a) => ({ id: tap("o", a.number), title: cut(`${ref(a)} ${showDay(lagos(a.start).day)}`, 24), description: cut(`${showTime(lagos(a.start).minute)} · ${names.get(a.variantId) ?? "Booking"}`, 72) })),
      },
    };
  }

  async function bookingCard(a: Appointment, names?: Map<string, string>): Promise<Reply> {
    const name = (names ?? (await variantNames())).get(a.variantId) ?? "Your booking";
    const who = a.calendarId ? (await opts.store.calendars()).find((c) => c.id === a.calendarId)?.name : null;
    const text = `${ref(a)}: *${name}*, ${showWhen(a.start)}${who ? ` with ${who}` : ""}${a.status === "held" ? " (waiting for payment)" : ""}`;
    return { text: "", buttons: { body: text, buttons: [{ id: tap("c", a.number), title: "Change time" }, { id: tap("x", a.number), title: "Cancel" }] } };
  }

  async function variantNames(): Promise<Map<string, string>> {
    return new Map((await opts.catalog.activeVariants()).map((v) => [v.id, short(v)]));
  }

  async function tooLate(a: Appointment): Promise<string | null> {
    const { cancelHours } = await opts.store.rules();
    if (a.start.getTime() - now().getTime() >= cancelHours * 3_600_000) return null;
    return `Sorry, ${ref(a)} is less than ${cancelHours} hours away, so it can't be changed here. Please message ${opts.businessName} directly.`;
  }

  async function cancelByCustomer(a: Appointment, waId: string, name: string | null): Promise<Reply> {
    const late = await tooLate(a);
    if (late) return { text: late };
    if (!(await opts.store.setStatus(a.id, "cancelled"))) return { text: `${ref(a)} is already cancelled.` };
    const paid = a.status === "booked" && a.payNowKobo > 0;
    if (a.orderId && a.status === "held") await opts.store.cancelUnpaidOrder(a.orderId);
    const names = await variantNames();
    return {
      text: `${ref(a)} is cancelled.${paid ? ` ${opts.businessName} will be in touch about the ${money(a.payNowKobo)} you paid.` : ""} Send *book* any time to book again.`,
      notify: toOwner(
        `${ref(a)} cancelled by ${name ?? "the customer"} (${waId}): ${names.get(a.variantId) ?? "booking"}, ${showWhen(a.start)}.${paid ? ` They paid ${money(a.payNowKobo)}: refund it, or keep it towards their next visit.` : ""}`,
      ),
    };
  }

  /** The service, its row and the booking being moved, for a tap. Null when any is gone. */
  async function tapTarget(variantId: string, moveToken: string | undefined, waId: string) {
    const { services, variants } = await bookable();
    const variant = variants.find((v) => v.id === variantId);
    const service = services.get(variantId);
    if (!variant || !service) return null;
    let move: Appointment | null = null;
    if (moveToken) {
      move = await opts.store.byNumber(Number(moveToken.slice(1)));
      if (!move || move.customerWaId !== waId || !["held", "booked"].includes(move.status)) return null;
    }
    return { variant, service, move };
  }

  async function onTap(text: string, ctx: CustomerContext): Promise<Reply | null> {
    const [, kind, ...rest] = text.trim().split(/\s+/);
    const gone: Reply = { text: "Sorry, that's no longer available. Send *book* to start again." };
    switch (kind) {
      case "s": {
        const t = await tapTarget(rest[0] ?? "", undefined, ctx.waId);
        return t ? choosePerson(t.variant, t.service, null) : gone;
      }
      case "p": {
        const t = await tapTarget(rest[0] ?? "", undefined, ctx.waId);
        return t ? chooseDay(t.variant, t.service, rest[1] === "any" ? null : rest[1] ?? null, null) : gone;
      }
      case "d": {
        const moveToken = rest.find((r) => /^m\d+$/.test(r));
        const t = await tapTarget(rest[0] ?? "", moveToken, ctx.waId);
        const day = rest[2] ?? "";
        if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return gone;
        const from = Number(rest[3] && !rest[3].startsWith("m") ? rest[3] : 0);
        return chooseTime(t.variant, t.service, rest[1] === "any" ? null : rest[1] ?? null, day, from, t.move);
      }
      case "t": {
        const moveToken = rest.find((r) => /^m\d+$/.test(r));
        const t = await tapTarget(rest[0] ?? "", moveToken, ctx.waId);
        const start = new Date(`${rest[2] ?? ""}Z`);
        if (!t || Number.isNaN(start.getTime())) return gone;
        if (t.move) {
          const late = await tooLate(t.move);
          if (late) return { text: late };
        }
        return takeTime(t.variant, t.service, rest[1] === "any" ? null : rest[1] ?? null, start, t.move, ctx);
      }
      case "o":
      case "x":
      case "c": {
        const a = await opts.store.byNumber(Number(rest[0]));
        if (!a || a.customerWaId !== ctx.waId || !["held", "booked"].includes(a.status)) return { text: "That booking isn't open any more. Send *my bookings* to see yours." };
        if (kind === "o") return bookingCard(a);
        if (kind === "x") return cancelByCustomer(a, ctx.waId, ctx.name);
        const late = await tooLate(a);
        if (late) return { text: late };
        const t = await tapTarget(a.variantId, `m${a.number}`, ctx.waId);
        return t ? choosePerson(t.variant, t.service, a) : gone;
      }
      default:
        return null;
    }
  }

  // Owner -----------------------------------------------------------------------

  async function priceListRows(): Promise<Variant[]> {
    return (await opts.catalog.activeVariants()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async function setupText(): Promise<string> {
    const [rows, services, calendars, classTimes, rules] = await Promise.all([
      priceListRows(),
      opts.store.services(),
      opts.store.calendars(),
      opts.store.classTimes(),
      opts.store.rules(),
    ]);
    if (!rows.length) return "Your price list is empty. Add your services to it first (e.g. Physiotherapy session, Personal training), then come back to *booking*.";
    const pay: Record<Payment, string> = { full: "pays in full to book", deposit: "deposit", later: "pays at the visit" };
    const list = rows.slice(0, 60).map((v, i) => {
      const s = services.get(v.id);
      if (!s) return `${i + 1}. ${short(v)}`;
      const times = classTimes.filter((c) => c.variantId === v.id);
      const when = s.places > 1 ? (times.length ? `, ${classTimesText(times)}` : ", no class times yet") : "";
      const how = s.payment === "deposit" ? `${money(s.depositKobo)} deposit` : pay[s.payment];
      return `${i + 1}. ${short(v)} 📅 ${s.minutes} min${s.places > 1 ? `, class of ${s.places}` : ""}${when}, ${how}`;
    });
    const cals = calendars.length
      ? calendars.map((c, i) => `${i + 1}. ${c.name}: ${hoursText(c)}${c.services.length ? ` (only ${c.services.map((id) => rows.findIndex((v) => v.id === id) + 1).filter((n) => n > 0).join(", ")})` : ""}`)
      : ["None yet."];
    return [
      "*Booking setup*. Bookable services are marked 📅",
      ...list,
      "",
      "*Calendars* (who customers book):",
      ...cals,
      "",
      `Rules: at least ${rules.noticeHours}h notice, up to ${rules.daysAhead} days ahead, cancel or change up to ${rules.cancelHours}h before.`,
      "",
      "Commands:",
      "• *book 3 60min*: row 3 becomes a 60-minute one-to-one session",
      "• *book 3 45min class 20*: a group class with 20 places",
      "• *book 3 deposit 5000*, *book 3 pay later*, *book 3 pay full*, *book 3 off*",
      "• *calendar add Dr Ada*, *calendar 1 Mon-Fri 9-5*, *calendar 1 Sat off*, *calendar 1 does 3 4*, *calendar 1 remove*",
      "• *class 3 Mon Wed Fri 7am* (add *with 1* for who takes it), *class 3 clear*",
      "• *block Sat*, *block 27 Nov 9-12*, *block Fri 2-4 for 1*",
      "• *booking rules notice 2 days 14 cancel 12*",
      "• *bookings*, *bookings tomorrow*, *done B12*, *no-show B12*, *cancel B12*, *move B12 to Sat 10am*",
    ].join("\n");
  }

  function hoursText(c: Calendar): string {
    if (!c.hours.size) return "no hours yet";
    const groups = new Map<string, number[]>();
    for (const [day, h] of c.hours) {
      const key = `${showTime(h.start)}-${showTime(h.end)}`;
      groups.set(key, [...(groups.get(key) ?? []), day]);
    }
    return [...groups].map(([hours, days]) => `${showWeekdays(days)} ${hours}`).join("; ");
  }

  function classTimesText(times: Array<{ weekday: number; startMinute: number }>): string {
    const groups = new Map<number, number[]>();
    for (const t of times) groups.set(t.startMinute, [...(groups.get(t.startMinute) ?? []), t.weekday]);
    return [...groups].map(([minute, days]) => `${showWeekdays(days)} ${showTime(minute)}`).join("; ");
  }

  async function setService(row: number, rest: string): Promise<string> {
    const variant = (await priceListRows())[row - 1];
    if (!variant) return `There's no row ${row} on your price list. Send *booking* to see the numbers.`;
    const name = short(variant);
    if (/^(off|remove|stop)$/i.test(rest)) {
      await opts.store.removeService(variant.id);
      return `${name} can no longer be booked. Bookings already made stay.`;
    }
    const current = (await opts.store.services()).get(variant.id);
    const minutes = rest.match(/(\d{1,3}(?:\.\d)?)\s*(min|mins|minutes|m|h|hr|hrs|hour|hours)\b/i);
    const places = rest.match(/\bclass(?:\s+of)?\s+(\d{1,3})\b/i);
    const one = /\b(one[\s-]to[\s-]one|1:1|private)\b/i.test(rest);
    const deposit = rest.match(/\bdeposit\s+((?:₦\s*)?\S+)/i);
    const later = /\bpay\s+(later|at (the )?visit)\b/i.test(rest);
    const full = /\bpay\s+(full|in full|now|upfront)\b/i.test(rest);
    if (!current && !minutes) return `How long is ${name}? Send e.g. *book ${row} 60min* (or *book ${row} 45min class 20* for a group class).`;
    const service: BookingService = current ?? { variantId: variant.id, minutes: 60, places: 1, payment: "full", depositKobo: 0 };
    if (minutes) {
      const n = Number(minutes[1]);
      service.minutes = Math.round(/^h/i.test(minutes[2]!) ? n * 60 : n);
      if (service.minutes < 5 || service.minutes > 720) return "A session can be 5 minutes to 12 hours long.";
    }
    if (places) service.places = Math.max(2, Math.min(500, Number(places[1])));
    if (one) service.places = 1;
    if (deposit) {
      const kobo = parseMoney(deposit[1]!, opts.currency ?? "NGN");
      if (kobo === null || kobo <= 0) return `I couldn't read that deposit. Send it as a plain amount, e.g. *book ${row} deposit 5000*.`;
      service.payment = "deposit";
      service.depositKobo = kobo;
    }
    if (later) service.payment = "later";
    if (full) service.payment = "full";
    if (!minutes && !places && !one && !deposit && !later && !full) return `I didn't follow that. Send *booking* to see the commands.`;
    await opts.store.saveService(service);

    const notes: string[] = [];
    const calendars = await opts.store.calendars();
    if (service.places === 1 && !calendars.length) {
      const cal = await opts.store.addCalendar(cut(opts.businessName, 40));
      await opts.store.setHours(cal.id, [1, 2, 3, 4, 5, 6], { start: 9 * 60, end: 17 * 60 });
      notes.push(`I made a calendar for you, *${cal.name}*, open Mon-Sat 9:00am-5:00pm. Change it with *calendar 1 Mon-Fri 8-6*, or add your team with *calendar add Dr Ada*.`);
    }
    if (service.places > 1 && !(await opts.store.classTimes()).some((c) => c.variantId === variant.id)) {
      notes.push(`Now set when it runs, e.g. *class ${row} Mon Wed Fri 7am*.`);
    }
    const how = service.payment === "deposit" ? `${money(service.depositKobo)} deposit to book, the rest at the visit` : service.payment === "later" ? "booked free, paid at the visit" : "paid in full to book";
    return [`📅 ${name}: ${service.minutes} min, ${service.places > 1 ? `group class of ${service.places}` : "one-to-one"}, ${how}. Customers book it by sending *book*.`, ...notes].join("\n\n");
  }

  async function calendarCommand(text: string): Promise<string | null> {
    const add = text.match(/^calendar\s+add\s+(.{1,40})$/i);
    if (add) {
      const cal = await opts.store.addCalendar(add[1]!.trim());
      const n = (await opts.store.calendars()).length;
      return `Added *${cal.name}* as calendar ${n}. Now set their hours, e.g. *calendar ${n} Mon-Fri 9-5*.`;
    }
    const m = text.match(/^calendar\s+(\d{1,2})\s+(.+)$/i);
    if (!m) return null;
    const calendars = await opts.store.calendars();
    const cal = calendars[Number(m[1]) - 1];
    if (!cal) return `There's no calendar ${m[1]}. Send *booking* to see them.`;
    const rest = m[2]!.trim();
    if (/^(remove|delete)$/i.test(rest)) {
      await opts.store.removeCalendar(cal.id);
      return `${cal.name} is removed. Their bookings stay; send *bookings* to see them.`;
    }
    const does = rest.match(/^does\s+(.+)$/i);
    if (does) {
      if (/^all$/i.test(does[1]!.trim())) {
        await opts.store.setCalendarServices(cal.id, []);
        return `${cal.name} now does every bookable service.`;
      }
      const rows = await priceListRows();
      const picked = does[1]!.split(/[\s,]+/).map(Number).map((n) => rows[n - 1]).filter((v): v is Variant => !!v);
      if (!picked.length) return "Send the row numbers from *booking*, e.g. *calendar 1 does 3 4*.";
      await opts.store.setCalendarServices(cal.id, picked.map((v) => v.id));
      return `${cal.name} now does: ${picked.map(short).join(", ")}.`;
    }
    const hours = rest.match(/^(.+?)\s+(off|\S+\s*(?:-|–|to)\s*\S+)$/i);
    const days = hours && readWeekdays(hours[1]!);
    if (!hours || !days) return `I didn't follow that. Try *calendar ${m[1]} Mon-Fri 9-5* or *calendar ${m[1]} Sun off*.`;
    if (/^off$/i.test(hours[2]!)) {
      await opts.store.setHours(cal.id, days, null);
      return `${cal.name} is off on ${showWeekdays(days)}.`;
    }
    const range = readHours(hours[2]!);
    if (!range) return `I couldn't read those hours. Try e.g. *9-5* or *8:30am-6pm*.`;
    await opts.store.setHours(cal.id, days, range);
    return `${cal.name}: ${showWeekdays(days)} ${showTime(range.start)}-${showTime(range.end)}.`;
  }

  async function classCommand(row: number, rest: string): Promise<string> {
    const variant = (await priceListRows())[row - 1];
    const service = variant && (await opts.store.services()).get(variant.id);
    if (!variant || !service || service.places < 2) return `Row ${row} isn't a group class yet. Make it one with e.g. *book ${row} 45min class 20*.`;
    if (/^(clear|off|none)$/i.test(rest)) {
      await opts.store.clearClassTimes(variant.id);
      return `${short(variant)} has no class times now.`;
    }
    const withCal = rest.match(/\s+with\s+(\d{1,2})$/i);
    const body = withCal ? rest.slice(0, withCal.index) : rest;
    const parts = body.match(/^(.+)\s+(\S+)$/);
    const days = parts && readWeekdays(parts[1]!);
    const minute = parts && readTime(parts[2]!);
    if (!days || minute === null || minute === undefined) return `I didn't follow that. Try *class ${row} Mon Wed Fri 7am*.`;
    let calendarId: string | null = null;
    if (withCal) {
      const cal = (await opts.store.calendars())[Number(withCal[1]) - 1];
      if (!cal) return `There's no calendar ${withCal[1]}. Send *booking* to see them.`;
      calendarId = cal.id;
    }
    await opts.store.setClassTimes(variant.id, calendarId, days, minute);
    return `${short(variant)} runs ${showWeekdays(days)} at ${showTime(minute)}. Add more times the same way, or *class ${row} clear* to start again.`;
  }

  async function blockCommand(rest: string): Promise<string> {
    const forCal = rest.match(/\s+for\s+(\d{1,2})$/i);
    const body = (forCal ? rest.slice(0, forCal.index) : rest).trim();
    const words = body.split(/\s+/);
    // The last word may be hours ("9-11"); everything before it is the day.
    const range = words.length > 1 ? readHours(words[words.length - 1]!) : null;
    const day = readDay(range ? words.slice(0, -1).join(" ") : body, now());
    if (!day) return "I didn't follow that. Try *block Sat*, *block 27 Nov 9-12* or *block Fri 2-4 for 1*.";
    let calendar: Calendar | null = null;
    if (forCal) {
      calendar = (await opts.store.calendars())[Number(forCal[1]) - 1] ?? null;
      if (!calendar) return `There's no calendar ${forCal[1]}. Send *booking* to see them.`;
    }
    const start = atLagos(day, range?.start ?? 0);
    const end = atLagos(day, range?.end ?? 24 * 60);
    await opts.store.addBlock(calendar?.id ?? null, start, end);
    const clash = (await opts.store.between(start, end)).filter((a) => ["held", "booked"].includes(a.status) && (!calendar || a.calendarId === calendar.id));
    return [
      `Blocked ${showDay(day)}${range ? ` ${showTime(range.start)}-${showTime(range.end)}` : " (all day)"}${calendar ? ` for ${calendar.name}` : ""}. Nobody can book then.`,
      ...(clash.length ? ["", `Already booked then: ${clash.map(ref).join(", ")}. Move them with e.g. *move ${ref(clash[0]!)} to Mon 10am*, or *cancel ${ref(clash[0]!)}*.`] : []),
    ].join("\n");
  }

  async function rulesCommand(rest: string): Promise<string> {
    const notice = rest.match(/\bnotice\s+(\d{1,3})/i);
    const days = rest.match(/\bdays\s+(\d{1,3})/i);
    const cancel = rest.match(/\bcancel\s+(\d{1,3})/i);
    if (notice || days || cancel) {
      await opts.store.setRules({
        ...(notice ? { noticeHours: Number(notice[1]) } : {}),
        ...(days ? { daysAhead: Math.max(1, Math.min(90, Number(days[1]))) } : {}),
        ...(cancel ? { cancelHours: Number(cancel[1]) } : {}),
      });
    }
    const r = await opts.store.rules();
    return `Booking rules: at least ${r.noticeHours}h notice, up to ${r.daysAhead} days ahead, customers can cancel or change up to ${r.cancelHours}h before. Change them with e.g. *booking rules notice 2 days 14 cancel 12*.`;
  }

  async function dayList(day: Day): Promise<string> {
    const list = await opts.store.between(atLagos(day, 0), atLagos(day, 24 * 60));
    if (!list.length) return `No bookings on ${showDay(day)}.`;
    const [names, calendars, services] = await Promise.all([variantNames(), opts.store.calendars(), opts.store.services()]);
    const mark: Record<string, string> = { booked: "", held: " (waiting for payment)", done: " ✓", no_show: " (no-show)" };
    const classes = new Map<string, Appointment[]>();
    const lines: Array<{ at: number; text: string }> = [];
    for (const a of list) {
      if ((a.status === "held" && a.heldUntil && a.heldUntil < now()) || a.status === "cancelled") continue;
      const key = `${a.variantId} ${a.start.getTime()}`;
      if ((services.get(a.variantId)?.places ?? 1) > 1) {
        classes.set(key, [...(classes.get(key) ?? []), a]);
        continue;
      }
      const who = calendars.find((c) => c.id === a.calendarId)?.name;
      const paid = a.payNowKobo > 0 && a.status !== "held" ? `, paid ${money(a.payNowKobo)}` : "";
      lines.push({ at: a.start.getTime(), text: `• ${showTime(lagos(a.start).minute)} ${names.get(a.variantId) ?? "Booking"}: ${a.customerName ?? a.customerWaId}${who ? ` with ${who}` : ""} (${ref(a)}${paid})${mark[a.status] ?? ""}` });
    }
    for (const group of classes.values()) {
      const a = group[0]!;
      const people = group.reduce((n, g) => n + g.places, 0);
      lines.push({ at: a.start.getTime(), text: `• ${showTime(lagos(a.start).minute)} ${names.get(a.variantId) ?? "Class"}: ${people} booked (${group.map((g) => g.customerName ?? g.customerWaId).join(", ")})` });
    }
    if (!lines.length) return `No bookings on ${showDay(day)}.`;
    lines.sort((x, y) => x.at - y.at);
    return [`*Bookings, ${showDay(day)}* (${lines.length})`, ...lines.map((l) => l.text)].join("\n");
  }

  async function ownerAction(kind: string, number: number, rest: string): Promise<Reply> {
    const a = await opts.store.byNumber(number);
    if (!a) return { text: `There's no booking B${number}.` };
    const names = await variantNames();
    const name = names.get(a.variantId) ?? "booking";
    if (kind === "done" || kind === "no-show" || kind === "noshow") {
      const ok = await opts.store.setStatus(a.id, kind === "done" ? "done" : "no_show");
      return { text: ok ? `${ref(a)} marked ${kind === "done" ? "done ✓" : "as a no-show"}.` : `${ref(a)} couldn't be marked (it's ${a.status.replace("_", "-")}).` };
    }
    if (kind === "cancel") {
      if (!(await opts.store.setStatus(a.id, "cancelled"))) return { text: `${ref(a)} is already cancelled.` };
      if (a.orderId && a.status === "held") await opts.store.cancelUnpaidOrder(a.orderId);
      return {
        text: `${ref(a)} cancelled. I've told ${a.customerName ?? "the customer"}.${a.status === "booked" && a.payNowKobo > 0 ? ` They paid ${money(a.payNowKobo)}: refund it or keep it towards their next visit.` : ""}`,
        notify: [{ to: a.customerWaId, text: `Sorry, ${opts.businessName} had to cancel ${ref(a)}: ${name}, ${showWhen(a.start)}. Send *book* to pick another time.` }],
      };
    }
    // move
    const target = rest.replace(/^to\s+/i, "").trim();
    const words = target.split(/\s+/);
    const minute = words.length > 1 ? readTime(words[words.length - 1]!) : null;
    const day = minute !== null ? readDay(words.slice(0, -1).join(" "), now()) : null;
    if (!day || minute === null) return { text: `I didn't follow that. Try *move ${ref(a)} to Sat 10am*.` };
    const service = (await opts.store.services()).get(a.variantId);
    if (!service) return { text: `${name} can't be booked any more, so ${ref(a)} can't be moved here.` };
    const start = atLagos(day, minute);
    const placed = await opts.store.place({
      variantId: a.variantId,
      calendarId: a.calendarId,
      start,
      end: new Date(start.getTime() + service.minutes * 60_000),
      waId: a.customerWaId,
      name: a.customerName,
      contactId: a.contactId,
      places: a.places,
      status: "booked",
      holdMinutes: 0,
      priceKobo: a.priceKobo,
      payNowKobo: a.payNowKobo,
      move: a.id,
    });
    if (!placed) return { text: `${showWhen(start)} is already taken${service.places > 1 ? " (the class is full)" : ""}. Pick another time.` };
    return {
      text: `${ref(a)} moved to ${showWhen(start)}. I've told ${a.customerName ?? "the customer"}.`,
      notify: [{ to: a.customerWaId, text: `${opts.businessName} has moved ${ref(a)} (${name}) to *${showWhen(start)}*. If that doesn't suit you, send *my bookings* to change it.` }],
    };
  }

  // Reminders ---------------------------------------------------------------------

  function reminder(a: Appointment, name: string, who: string | null, soon: boolean, canChange: boolean): Notice {
    const when = showWhen(a.start);
    const text = soon
      ? `Reminder: ${name} at ${opts.businessName} is at *${showTime(lagos(a.start).minute)}* today${who ? ` with ${who}` : ""} (${ref(a)}). See you soon!`
      : `Reminder: you're booked for ${name} at ${opts.businessName}, *${when}*${who ? ` with ${who}` : ""} (${ref(a)}).`;
    const template: OutgoingTemplate | undefined = opts.template
      ? { name: opts.template.name, language: opts.template.language, bodyParams: [opts.businessName, name, `${when}${who ? ` with ${who}` : ""}`, ref(a)] }
      : undefined;
    return {
      to: a.customerWaId,
      text,
      ...(canChange ? { buttons: { body: "Can't make it?", buttons: [{ id: tap("c", a.number), title: "Change time" }, { id: tap("x", a.number), title: "Cancel" }] } } : {}),
      ...(template ? { template } : {}),
    };
  }

  return {
    async customerMessage(msg, ctx) {
      const text = (msg.text ?? "").trim();
      if (!text) return null;
      const isTap = text.startsWith(`${TAP} `);
      if (!isTap && !MINE.test(text) && !BOOK.test(text)) return null;
      if (!(await onPlan())) return null;
      if (isTap) return onTap(text, ctx);
      if (MINE.test(text)) return myBookings(ctx.waId);
      if (!(await opts.store.services()).size) return null;
      return chooseService();
    },

    async forQuote(variantIds) {
      if (!variantIds.length || !(await onPlan())) return null;
      const { services, variants } = await bookable();
      const variant = variants.find((v) => variantIds.includes(v.id));
      return variant ? choosePerson(variant, services.get(variant.id)!, null) : null;
    },

    async ownerCommand(msg) {
      const text = (msg.text ?? "").trim().replace(/\s+/g, " ");
      const setup = /^(booking|bookings setup|booking setup|appointments setup|calendars)$/i.test(text);
      const day = text.match(/^(?:bookings|appointments|schedule)(?:\s+(.+))?$/i);
      const svc = text.match(/^book\s+(\d{1,3})\s+(.+)$/i);
      const cls = text.match(/^class\s+(\d{1,3})\s+(.+)$/i);
      const block = text.match(/^block\s+(.+)$/i);
      const rules = text.match(/^booking rules\b\s*(.*)$/i);
      const act = text.match(/^(done|no-?show|cancel|move)\s+b(\d{1,9})\b\s*(.*)$/i);
      const cal = /^calendar\s/i.test(text);
      if (!setup && !day && !svc && !cls && !block && !rules && !act && !cal) return null;
      if (!(await onPlan())) return { text: "Appointment booking comes with Pro and above. Send *plan* to see how to upgrade." };
      if (setup) return { text: await setupText() };
      if (svc) return { text: await setService(Number(svc[1]), svc[2]!.trim()) };
      if (cls) return { text: await classCommand(Number(cls[1]), cls[2]!.trim()) };
      if (block) return { text: await blockCommand(block[1]!) };
      if (rules) return { text: await rulesCommand(rules[1] ?? "") };
      if (act) return ownerAction(act[1]!.toLowerCase(), Number(act[2]), act[3] ?? "");
      if (cal) return { text: (await calendarCommand(text)) ?? "I didn't follow that. Send *booking* to see the commands." };
      const which = day![1]?.trim();
      const d = which ? readDay(which, now()) : lagos(now()).day;
      if (!d) return { text: "Which day? Try *bookings today*, *bookings tomorrow* or *bookings Sat*." };
      return { text: await dayList(d) };
    },

    async paid(orderId) {
      const held = await opts.store.forOrder(orderId);
      if (!held.length) return null;
      const [names, calendars, services] = await Promise.all([variantNames(), opts.store.calendars(), opts.store.services()]);
      const customer: string[] = [];
      const owner: string[] = [];
      for (const a of held) {
        if (a.status === "held") await opts.store.book(a.id);
        else if (a.status !== "booked") continue;
        const name = names.get(a.variantId) ?? "Booking";
        const who = calendars.find((c) => c.id === a.calendarId)?.name;
        const rest = a.priceKobo - a.payNowKobo;
        customer.push(`You're booked ✅ ${name}, *${showWhen(a.start)}*${who ? ` with ${who}` : ""} (${ref(a)}).${rest > 0 ? ` The other ${money(rest)} is paid at your visit.` : ""} I'll remind you the day before. Send *my bookings* to cancel or change it.`);
        // Paid after the hold ran out: someone else may have taken the time meanwhile.
        const late = a.heldUntil && a.heldUntil < now();
        let clash = false;
        if (late) {
          const others = (await opts.store.busy(a.start, a.end)).filter((b) => !(b.start.getTime() === a.start.getTime() && b.variantId === a.variantId && b.calendarId === a.calendarId && b.places === a.places));
          const size = services.get(a.variantId)?.places ?? 1;
          clash = size > 1
            ? others.filter((b) => b.variantId === a.variantId && b.start.getTime() === a.start.getTime()).reduce((n, b) => n + b.places, 0) + a.places > size
            : others.some((b) => b.calendarId === a.calendarId);
        }
        owner.push(`Booked ${ref(a)}: ${name}, ${showWhen(a.start)}${who ? ` with ${who}` : ""}.${clash ? ` ⚠️ They paid after their hold ran out and someone else has that time too. Move one of them with *move ${ref(a)} to ...*.` : ""}`);
      }
      return customer.length ? { customer: customer.join("\n\n"), owner: owner.join("\n") } : null;
    },

    async due(at) {
      if (!(await onPlan())) return [];
      const notes: Notice[] = [];
      const names = await variantNames();

      for (const a of await opts.store.expiredHolds(new Date(at.getTime() - RELEASE_GRACE_MS))) {
        if (!(await opts.store.setStatus(a.id, "cancelled"))) continue;
        if (a.orderId) await opts.store.cancelUnpaidOrder(a.orderId);
        notes.push({ to: a.customerWaId, text: `I've let go of ${names.get(a.variantId) ?? "your booking"}, ${showWhen(a.start)} (${ref(a)}), as the payment didn't come through. Send *book* to pick a time again.` });
      }

      const calendars = await opts.store.calendars();
      const { cancelHours } = await opts.store.rules();
      const hour = 3_600_000;
      const { minute } = lagos(at);
      const daytime = minute >= 8 * 60 && minute < 20 * 60;
      const kinds: Array<["day" | "soon", Date, Date]> = [["soon", at, new Date(at.getTime() + 2 * hour)]];
      // The day-before reminder goes 12 to 24 hours ahead, in the daytime.
      if (daytime) kinds.push(["day", new Date(at.getTime() + 12 * hour), new Date(at.getTime() + 24 * hour)]);
      for (const [kind, from, to] of kinds) {
        for (const a of await opts.store.needReminder(kind, from, to)) {
          if (!(await opts.store.claimReminder(a.id, kind))) continue;
          const who = calendars.find((c) => c.id === a.calendarId)?.name ?? null;
          const canChange = a.start.getTime() - at.getTime() >= cancelHours * hour;
          notes.push(reminder(a, names.get(a.variantId) ?? "your booking", who, kind === "soon", canChange));
        }
      }
      return notes;
    },

    async summary(at) {
      const text = await dayList(lagos(at).day);
      return text.startsWith("No bookings") ? null : `Good morning ☀️ ${text}\n\nSend *done B12* or *no-show B12* after each visit.`;
    },

    claimSummary: (at) => opts.store.claimSummary(lagos(at).day),
  };
}

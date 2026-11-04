import type { SupabaseClient } from "@supabase/supabase-js";
import { assertKobo, formatNaira } from "../../core/money.js";
import type { OutgoingNote, PaidHandler, Payments } from "../../core/payments/payments.js";
import type { SavedCard } from "../../core/payments/paystack.js";
import type { Notice } from "../../core/product.js";
import type { OutgoingTemplate } from "../../core/whatsapp/client.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { lagosHour } from "./followups.js";

// Monthly payments from a business's regular customers (QUOTE_MONTHLY_PAYMENTS,
// migration 0067): gym members, class fees, a monthly supply. The owner sets
// up plans and adds customers in the owner app; each month the customer is
// charged on their pay day.
//
// - Paid by card once: Paystack lets us charge the same card each month,
//   without a link. If the card is declined, a link goes instead.
// - Paid by transfer or USSD: a fresh Paystack link each month.
// - Unpaid: reminders 3 and 7 days after the pay day, then the owner is told.
//
// Money goes to the business's own bank through its Paystack subaccount, as
// with invoice pay links, less the plan's transaction fee. Each month is a
// row with a unique (member, month), so it's billed once however often the
// timer runs, and a payment counts once however often Paystack calls.

export interface MonthlyPlan {
  id: string;
  name: string;
  priceKobo: number;
  active: boolean;
}

/** A month a member owes and hasn't paid yet. */
export interface OpenMonth {
  id: string;
  /** The pay day it's for, YYYY-MM-DD. */
  period: string;
  amountKobo: number;
  linkUrl: string | null;
  /** Messages sent about it: 1 when it fell due, 2 and 3 for the reminders. */
  notices: number;
  cardTriedAt: Date | null;
  ownerToldAt: Date | null;
}

export interface Member {
  id: string;
  planId: string;
  planName: string;
  name: string;
  waId: string;
  /** Day of the month they pay on; 31 means the last day in shorter months. */
  payDay: number;
  /** YYYY-MM-DD. Only moves on once that month is paid. */
  nextDue: string;
  status: "active" | "cancelled";
  card: SavedCard | null;
  lastPaidAt: Date | null;
  open: OpenMonth | null;
}

export type NewMember = Pick<Member, "planId" | "name" | "waId" | "payDay" | "nextDue">;

export interface MonthlyStore {
  plans(): Promise<MonthlyPlan[]>;
  addPlan(name: string, priceKobo: number): Promise<void>;
  setPlanActive(id: string, active: boolean): Promise<void>;
  members(): Promise<Member[]>;
  member(id: string): Promise<Member | null>;
  addMember(m: NewMember): Promise<string>;
  /** False when they're not on the list or already cancelled. */
  cancel(id: string): Promise<boolean>;
  forgetCard(id: string): Promise<void>;
  /** Opens the month due for each active member whose pay day has come, at the plan's price today. */
  openDue(today: string): Promise<void>;
  /** True for the one call that marks the card tried for this month. */
  claimCard(monthId: string): Promise<boolean>;
  saveLink(monthId: string, url: string): Promise<void>;
  /** True for the one call that records message `n` (it only follows message n - 1). */
  claimNotice(monthId: string, n: number): Promise<boolean>;
  claimOwnerTold(monthId: string): Promise<boolean>;
  /** The member and month a payment was for, if it's this business's. */
  month(monthId: string): Promise<{ member: Member; period: string; amountKobo: number } | null>;
  /** Marks the month paid and moves next_due on (migration 0067). True only for the first call. */
  paid(monthId: string, reference: string, nextDue: string, card: SavedCard | null): Promise<boolean>;
}

// ---- Dates (Lagos is UTC+1 all year) ----

/** Today in Lagos, YYYY-MM-DD. */
export function lagosToday(now: Date): string {
  return new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The pay day in the month after `date`: 31 Jan with pay day 31 -> 28 or 29 Feb, then 31 Mar. */
export function nextPayDay(date: string, payDay: number): string {
  const [y, m] = parts(date);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  const day = Math.min(payDay, daysIn(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "2026-11-05" -> "5 November". */
export function showDay(date: string): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** "2026-11-05" -> "November". */
export function monthOf(date: string): string {
  const [y, m] = parts(date);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}

/** Days after the pay day each reminder goes, and when the owner hears it's overdue. */
export const REMINDER_DAYS = [3, 7] as const;
const FIRST_HOUR = 8;
const LAST_HOUR = 20;

// ---- Billing ----

export interface MonthlyDeps {
  store: MonthlyStore;
  payments: Pick<Payments, "createLink" | "chargeCard">;
  businessId: string;
  businessName: string;
  /** The business's Paystack subaccount (ACCT_...), where the money goes. */
  subaccount: string;
  /** yarnOga's fee on a payment of this many kobo (the plan's transaction_fee). */
  feeKobo(amountKobo: number): Promise<number>;
  canMessageFreely(waId: string): Promise<boolean>;
  /**
   * An approved WhatsApp template for when the customer hasn't messaged in
   * the last day. Body values: {{1}} customer, {{2}} business, {{3}} amount,
   * {{4}} plan and month, {{5}} link.
   */
  template?: { name: string; language: string };
  /** Sends from the business's own number. */
  send(note: Notice): Promise<void>;
  ownerWaId: string | null;
  now?: () => Date;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export type BillResult = { paid: true } | { paid: false; link: string; reached: boolean };

export function createMonthly(deps: MonthlyDeps) {
  const log = deps.log ?? console;
  const now = () => (deps.now ? deps.now() : new Date());
  const what = (m: Member, period: string) => `${m.planName}, ${monthOf(period)}`;

  async function tellOwner(text: string) {
    if (!deps.ownerWaId) return;
    try {
      await deps.send({ to: deps.ownerWaId, text });
    } catch (err) {
      log.warn(`Monthly payments: couldn't tell the ${deps.businessName} owner "${text.slice(0, 40)}...":`, err);
    }
  }

  /** The customer gets the link; true if WhatsApp lets us reach them. */
  async function sendLink(m: Member, open: OpenMonth, link: string, text: string): Promise<boolean> {
    if (await deps.canMessageFreely(m.waId)) {
      await deps.send({ to: m.waId, text });
      return true;
    }
    if (!deps.template) return false;
    await deps.send({
      to: m.waId,
      text,
      template: {
        name: deps.template.name,
        language: deps.template.language,
        bodyParams: [m.name, deps.businessName, formatNaira(open.amountKobo), what(m, open.period), link],
      } satisfies OutgoingTemplate,
    });
    return true;
  }

  async function makeLink(m: Member, open: OpenMonth): Promise<string> {
    if (open.linkUrl) return open.linkUrl;
    const fee = await deps.feeKobo(open.amountKobo);
    const link = await deps.payments.createLink({
      product: "monthly",
      waId: m.waId,
      amountKobo: open.amountKobo,
      purpose: { businessId: deps.businessId, monthId: open.id, ...(fee ? { feeKobo: fee } : {}) },
      title: `${deps.businessName}: ${m.name}, ${what(m, open.period)}`,
      subaccount: deps.subaccount,
      ...(fee ? { platformFeeKobo: fee } : {}),
    });
    if (!link.url) throw new Error("No payment link was made");
    await deps.store.saveLink(open.id, link.url);
    open.linkUrl = link.url;
    return link.url;
  }

  /** Tries the saved card once for this month. Null when there's no card to try. */
  async function tryCard(m: Member, open: OpenMonth): Promise<"paid" | "failed" | "pending" | null> {
    if (!m.card || open.cardTriedAt) return null;
    if (!(await deps.store.claimCard(open.id))) return "pending";
    open.cardTriedAt = now();
    const fee = await deps.feeKobo(open.amountKobo);
    try {
      return await deps.payments.chargeCard({
        product: "monthly",
        waId: m.waId,
        amountKobo: open.amountKobo,
        purpose: { businessId: deps.businessId, monthId: open.id, ...(fee ? { feeKobo: fee } : {}) },
        title: `${deps.businessName}: ${m.name}, ${what(m, open.period)}`,
        card: m.card,
        subaccount: deps.subaccount,
        ...(fee ? { platformFeeKobo: fee } : {}),
      });
    } catch (err) {
      // Paystack may still have charged it; its webhook will say. A link only goes after a day.
      log.error(`Monthly payments: charging ${m.name}'s card for ${deps.businessName} failed:`, err);
      return "pending";
    }
  }

  function dueText(m: Member, open: OpenMonth, link: string, cardDeclined: boolean): string {
    const declined = cardDeclined && m.card ? `We tried your ${m.card.label} but the payment didn't go through. ` : "";
    return (
      `Hi ${m.name}, your ${formatNaira(open.amountKobo)} for ${what(m, open.period)} at ${deps.businessName} is due. ${declined}Pay here: ${link}\n\n` +
      (m.card ? "" : "Pay by card and we'll take it from the same card each month, so you won't need a link. Or pay by transfer each time.")
    ).trim();
  }

  function reminderText(m: Member, open: OpenMonth, link: string, n: number): string {
    return n === 2
      ? `Hi ${m.name}, a reminder: your ${formatNaira(open.amountKobo)} for ${what(m, open.period)} at ${deps.businessName} hasn't come in yet. Pay here: ${link}`
      : `Hi ${m.name}, your ${formatNaira(open.amountKobo)} for ${what(m, open.period)} at ${deps.businessName} is now a week late. Please pay here: ${link}\nIf you'd like to stop, just reply and let us know.`;
  }

  /**
   * Bills a member's open month now: the card if they have one, else a link.
   * Used when the owner adds a customer due today, and by the timer.
   */
  async function bill(m: Member, open: OpenMonth): Promise<BillResult> {
    const card = await tryCard(m, open);
    if (card === "paid") return { paid: true };
    const link = await makeLink(m, open);
    if (card === "pending") return { paid: false, link, reached: false };
    if (!(await deps.store.claimNotice(open.id, 1))) return { paid: false, link, reached: open.notices > 0 };
    const declined = card === "failed" || (card === null && open.cardTriedAt !== null);
    const reached = await sendLink(m, open, link, dueText(m, open, link, declined));
    if (!reached) {
      await tellOwner(
        `${m.name} (${showWaId(m.waId)}) owes ${formatNaira(open.amountKobo)} for ${what(m, open.period)}. WhatsApp won't let your bot message them first, so please send them this link from your phone: ${link}`,
      );
    }
    return { paid: false, link, reached };
  }

  async function step(m: Member, open: OpenMonth, today: string) {
    if (open.notices === 0) {
      // A card charge still processing gets a day before a link goes, so nobody pays twice.
      if (m.card && open.cardTriedAt && now().getTime() - open.cardTriedAt.getTime() < 86_400_000) return;
      await bill(m, open);
      return;
    }
    const link = open.linkUrl ?? (await makeLink(m, open));
    for (const [i, days] of REMINDER_DAYS.entries()) {
      const n = i + 2;
      if (open.notices !== n - 1 || today < addDays(open.period, days)) continue;
      if (!(await deps.store.claimNotice(open.id, n))) return;
      const reached = await sendLink(m, open, link, reminderText(m, open, link, n)).catch((err) => {
        log.warn(`Monthly payments: reminder ${n} to ${m.name} not sent:`, err);
        return false;
      });
      open.notices = n;
      if (n === 3 && (await deps.store.claimOwnerTold(open.id))) {
        await tellOwner(
          `${m.name} (${showWaId(m.waId)}) hasn't paid ${formatNaira(open.amountKobo)} for ${what(m, open.period)}; it was due on ${showDay(open.period)}.` +
            `${reached ? " We've reminded them twice." : ` We couldn't message them, so please send them the link: ${link}`}` +
            " If they've stopped coming, cancel them under Monthly payments in the app.",
        );
      }
      return;
    }
  }

  return {
    store: deps.store,
    bill,

    /** The timer: opens months that have come due, then charges, sends links and reminders. */
    async run() {
      const at = now();
      const today = lagosToday(at);
      await deps.store.openDue(today);
      const hour = lagosHour(at);
      // Charges and messages go in the daytime only.
      if (hour < FIRST_HOUR || hour >= LAST_HOUR) return;
      for (const m of await deps.store.members()) {
        if (m.status !== "active" || !m.open) continue;
        try {
          await step(m, m.open, today);
        } catch (err) {
          log.error(`Monthly payments: ${m.name} at ${deps.businessName} failed:`, err);
        }
      }
    },

    /** A month paid by link or card: the customer's receipt and the owner's note. */
    async paid(payment: Parameters<PaidHandler>[0], card?: SavedCard): Promise<OutgoingNote[]> {
      const monthId = payment.purpose.monthId;
      if (typeof monthId !== "string") throw new Error(`Monthly payment ${payment.reference} has no month`);
      const found = await deps.store.month(monthId);
      if (!found) throw new Error(`Monthly payment ${payment.reference} is for a month we can't find`);
      const { member: m, period, amountKobo } = found;
      const next = nextPayDay(period, m.payDay);
      if (!(await deps.store.paid(monthId, payment.reference, next, card ?? null))) return [];
      const fee = Number.isInteger(payment.purpose.feeKobo) ? (payment.purpose.feeKobo as number) : 0;
      const savedNow = card && card.code !== m.card?.code;
      const how = card && !savedNow ? ` Paid with your ${card.label}.` : "";
      const after = savedNow
        ? ` We'll take it from your ${card.label} on that day. To pay another way or to stop, just tell us here.`
        : m.card || card
          ? ""
          : " We'll send you a link then.";
      const notes: OutgoingNote[] = [
        {
          to: m.waId,
          text: `Payment received, thank you ${m.name}. ${formatNaira(amountKobo)} for ${what(m, period)} at ${deps.businessName}.${how} Your next payment is due on ${showDay(next)}.${after}`,
        },
      ];
      if (deps.ownerWaId) {
        notes.push({
          to: deps.ownerWaId,
          text: `💰 ${m.name} paid ${formatNaira(amountKobo)} for ${what(m, period)}${card && !savedNow ? ` (saved card)` : ""}. It goes to your bank${fee ? ` less yarnOga's fee of ${formatNaira(fee)} and Paystack's` : " less Paystack's fee"}. Next due ${showDay(next)}.`,
        });
      }
      return notes;
    },
  };
}

export type Monthly = ReturnType<typeof createMonthly>;

// ---- Database ----

type Row = Record<string, unknown>;

function rows(data: unknown, error: { message: string } | null, what: string): Row[] {
  if (error) throw new Error(`${what} failed: ${error.message}`);
  return (data as Row[] | null) ?? [];
}

const date = (v: unknown) => (v ? new Date(String(v)) : null);

const MEMBER_COLUMNS =
  "id, plan_id, name, wa_id, pay_day, next_due, status, card_code, card_email, card_label, last_paid_at, quote_monthly_plans(name), " +
  "quote_monthly_charges(id, period, amount_kobo, status, link_url, notices, card_tried_at, owner_told_at)";

function toMember(r: Row): Member {
  const plan = r.quote_monthly_plans as { name?: string } | null;
  const open = ((r.quote_monthly_charges as Row[] | null) ?? []).filter((c) => c.status === "open").sort((a, b) => String(a.period).localeCompare(String(b.period)))[0];
  return {
    id: r.id as string,
    planId: r.plan_id as string,
    planName: plan?.name ?? "Monthly",
    name: r.name as string,
    waId: r.wa_id as string,
    payDay: Number(r.pay_day),
    nextDue: String(r.next_due),
    status: r.status === "cancelled" ? "cancelled" : "active",
    card: r.card_code ? { code: r.card_code as string, email: String(r.card_email ?? ""), label: String(r.card_label ?? "Card") } : null,
    lastPaidAt: date(r.last_paid_at),
    open: open
      ? {
          id: open.id as string,
          period: String(open.period),
          amountKobo: Number(open.amount_kobo),
          linkUrl: (open.link_url as string | null) ?? null,
          notices: Number(open.notices ?? 0),
          cardTriedAt: date(open.card_tried_at),
          ownerToldAt: date(open.owner_told_at),
        }
      : null,
  };
}

export function createSupabaseMonthlyStore(db: SupabaseClient, businessId: string): MonthlyStore {
  async function claim(monthId: string, set: Row, where: (q: ReturnType<ReturnType<SupabaseClient["from"]>["update"]>) => typeof q) {
    const { data, error } = await where(db.from("quote_monthly_charges").update(set).eq("id", monthId).eq("status", "open")).select("id");
    return rows(data, error, "monthly payment update").length === 1;
  }

  const store: MonthlyStore = {
    async plans() {
      const { data, error } = await db.from("quote_monthly_plans").select("id, name, price_kobo, active").eq("business_id", businessId).order("created_at");
      return rows(data, error, "monthly plans").map((r) => ({ id: r.id as string, name: r.name as string, priceKobo: Number(r.price_kobo), active: r.active === true }));
    },

    async addPlan(name, priceKobo) {
      assertKobo(priceKobo);
      const { error } = await db.from("quote_monthly_plans").insert({ business_id: businessId, name, price_kobo: priceKobo });
      if (error) throw new Error(`add monthly plan failed: ${error.message}`);
    },

    async setPlanActive(id, active) {
      const { error } = await db.from("quote_monthly_plans").update({ active }).eq("id", id).eq("business_id", businessId);
      if (error) throw new Error(`monthly plan update failed: ${error.message}`);
    },

    async members() {
      const { data, error } = await db.from("quote_monthly_members").select(MEMBER_COLUMNS).eq("business_id", businessId).order("name");
      return rows(data, error, "monthly members").map(toMember);
    },

    async member(id) {
      const { data, error } = await db.from("quote_monthly_members").select(MEMBER_COLUMNS).eq("business_id", businessId).eq("id", id).maybeSingle();
      if (error) throw new Error(`monthly member failed: ${error.message}`);
      return data ? toMember(data as unknown as Row) : null;
    },

    async addMember(m) {
      const { data, error } = await db
        .from("quote_monthly_members")
        .insert({ business_id: businessId, plan_id: m.planId, name: m.name, wa_id: m.waId, pay_day: m.payDay, next_due: m.nextDue })
        .select("id")
        .single();
      if (error) throw new Error(`add monthly member failed: ${error.message}`);
      return (data as Row).id as string;
    },

    async cancel(id) {
      const { data, error } = await db
        .from("quote_monthly_members")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id)
        .eq("business_id", businessId)
        .eq("status", "active")
        .select("id");
      return rows(data, error, "cancel monthly member").length === 1;
    },

    async forgetCard(id) {
      const { error } = await db.from("quote_monthly_members").update({ card_code: null, card_email: null, card_label: null }).eq("id", id).eq("business_id", businessId);
      if (error) throw new Error(`forget card failed: ${error.message}`);
    },

    async openDue(today) {
      const { data, error } = await db
        .from("quote_monthly_members")
        .select("id, next_due, quote_monthly_plans(price_kobo)")
        .eq("business_id", businessId)
        .eq("status", "active")
        .lte("next_due", today);
      const due = rows(data, error, "monthly members due").map((r) => ({
        member_id: r.id as string,
        period: String(r.next_due),
        amount_kobo: Number((r.quote_monthly_plans as { price_kobo?: number } | null)?.price_kobo),
      }));
      if (!due.length) return;
      const { error: e } = await db.from("quote_monthly_charges").upsert(due, { onConflict: "member_id,period", ignoreDuplicates: true });
      if (e) throw new Error(`open monthly payments failed: ${e.message}`);
    },

    claimCard: (monthId) => claim(monthId, { card_tried_at: new Date().toISOString() }, (q) => q.is("card_tried_at", null)),

    async saveLink(monthId, url) {
      const { error } = await db.from("quote_monthly_charges").update({ link_url: url }).eq("id", monthId);
      if (error) throw new Error(`save monthly link failed: ${error.message}`);
    },

    claimNotice: (monthId, n) => claim(monthId, { notices: n, last_notice_at: new Date().toISOString() }, (q) => q.eq("notices", n - 1)),

    claimOwnerTold: (monthId) => claim(monthId, { owner_told_at: new Date().toISOString() }, (q) => q.is("owner_told_at", null)),

    async month(monthId) {
      const { data, error } = await db.from("quote_monthly_charges").select("member_id, period, amount_kobo").eq("id", monthId).maybeSingle();
      if (error) throw new Error(`monthly payment lookup failed: ${error.message}`);
      const member = data ? await store.member((data as Row).member_id as string) : null;
      return member ? { member, period: String((data as Row).period), amountKobo: Number((data as Row).amount_kobo) } : null;
    },

    async paid(monthId, reference, nextDue, card) {
      const { data, error } = await db.rpc("quote_monthly_paid", {
        p_charge: monthId,
        p_reference: reference,
        p_next_due: nextDue,
        p_card_code: card?.code ?? null,
        p_card_email: card?.email ?? null,
        p_card_label: card?.label ?? null,
      });
      if (error) throw new Error(`quote_monthly_paid failed: ${error.message}`);
      return data === true;
    },
  };
  return store;
}

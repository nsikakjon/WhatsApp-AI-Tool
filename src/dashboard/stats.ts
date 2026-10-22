import type { SupabaseClient } from "@supabase/supabase-js";

// The numbers on the owner's dashboard, read straight from the database every
// time the page loads. Nothing here is estimated: every figure is a count or a
// sum of real rows. Money is in kobo, like everywhere else.

export interface DailyCount {
  /** Lagos calendar day, e.g. "2026-10-16". */
  date: string;
  count: number;
}

export interface PlanCount {
  id: string;
  /** Groups on this plan right now (a paid plan past its end date counts as Free). */
  groups: number;
  /** List price per month in kobo; null when the price is "on request". */
  monthlyPriceKobo: number | null;
}

export interface NumberUse {
  label: string;
  /** Messages sent this Lagos month. */
  sent: number;
  /** Connected by the business through the sign-up page, so Meta bills the business, not yarnOga. */
  ownAccount: boolean;
}

/** One of our WhatsApp numbers and the name to show for it. The main number comes first. */
export interface NumberLabel {
  id: string;
  label: string;
}

export interface DashboardStats {
  generatedAt: Date;
  whatsapp: {
    /** Everyone who has ever messaged any of the numbers. */
    contacts: number;
    newContacts7: number;
    newContacts30: number;
    inbound7: number;
    inbound30: number;
    outbound30: number;
    voiceNotes30: number;
    /** Messages received per Lagos day, oldest first, last 30 days. */
    dailyInbound: DailyCount[];
    /** Messages each number sent this month, busiest first; null until migration 0043 is run. */
    sentThisMonth: NumberUse[] | null;
  };
  flyers: {
    groups: number;
    newGroups30: number;
    members: number;
    birthdayFlyersAll: number;
    birthdayFlyers30: number;
    plans: PlanCount[];
    /** Groups on any plan other than Free. */
    paidGroups: number;
    /** What the paid groups' plans are worth per month at list price (not cash received). */
    planValueKobo: number;
    /** Paid groups on a plan with no fixed price, left out of planValueKobo. */
    groupsOnRequestPrice: number;
  };
  quotes: {
    quoted: number;
    confirmed: number;
    paid: number;
    cancelled: number;
    /** Orders marked paid, all time and in the last 30 days. */
    paidKobo: number;
    paid30Kobo: number;
    /** Confirmed orders not yet marked paid. */
    awaitingPaymentKobo: number;
  };
  site: {
    sites: number;
    members: number;
    updates7: number;
    updates30: number;
    photos30: number;
    voiceNotes30: number;
    reports30: number;
  };
  leads: {
    total: number;
    new30: number;
    hot: number;
    warm: number;
    cold: number;
    handedOff: number;
  };
}

export interface StatsSource {
  load(now: Date): Promise<DashboardStats>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Lagos is UTC+1 all year (no daylight saving).
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** The last `days` Lagos days ending today, oldest first, with when each starts and ends. */
export function lagosDays(now: Date, days: number): { date: string; start: Date; end: Date }[] {
  const lagosNow = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const todayStartUtc =
    Date.UTC(lagosNow.getUTCFullYear(), lagosNow.getUTCMonth(), lagosNow.getUTCDate()) - LAGOS_OFFSET_MS;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = todayStartUtc - i * DAY_MS;
    out.push({
      date: new Date(start + LAGOS_OFFSET_MS).toISOString().slice(0, 10),
      start: new Date(start),
      end: new Date(start + DAY_MS),
    });
  }
  return out;
}

/** Which plan a group is really on: a paid plan whose end date has passed is Free. */
export function effectivePlan(plan: string, planUntil: string | null, now: Date): string {
  if (plan !== "free" && planUntil && new Date(planUntil).getTime() <= now.getTime()) return "free";
  return plan;
}

type Filter = (q: any) => any;

/** The Lagos month as its first day, e.g. "2026-10-01". */
export function lagosMonth(now: Date): string {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 8) + "01";
}

/**
 * Puts a name on each number's count. Messages saved without a number id ("")
 * went out from the main number, so they are added to it.
 */
export function summariseSent(
  counts: { business_number_id: string; sent: number }[],
  numbers: NumberLabel[],
  businesses: { phone_number_id: string | null; name: string }[],
  connections: { phone_number_id: string; verified_name: string | null }[],
): NumberUse[] {
  const mainId = numbers[0]?.id ?? "";
  const totals = new Map<string, number>();
  for (const c of counts) {
    const id = c.business_number_id || mainId;
    totals.set(id, (totals.get(id) ?? 0) + Number(c.sent));
  }
  const own = new Map(connections.map((c) => [c.phone_number_id, c.verified_name]));
  return [...totals]
    .map(([id, sent]) => ({
      label:
        numbers.find((n) => n.id === id)?.label ??
        businesses.find((b) => b.phone_number_id === id)?.name ??
        own.get(id) ??
        `Number ${id}`,
      sent,
      ownAccount: own.has(id),
    }))
    .sort((a, b) => b.sent - a.sent);
}

export function createSupabaseStats(db: SupabaseClient, numbers: NumberLabel[] = []): StatsSource {
  async function count(table: string, filter: Filter = (q) => q): Promise<number> {
    const { count: n, error } = await filter(db.from(table).select("*", { count: "exact", head: true }));
    if (error) throw new Error(`Counting ${table} failed: ${error.message}`);
    return n ?? 0;
  }

  // Reads every row, a page at a time (Supabase returns at most 1000 per request).
  async function all<T>(table: string, columns: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(columns).range(from, from + 999);
      if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) return rows;
    }
  }

  return {
    async load(now) {
      const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
      const d7 = since(7);
      const d30 = since(30);
      const days = lagosDays(now, 30);

      const [
        contacts, newContacts7, newContacts30, inbound7, inbound30, outbound30, voiceNotes30, daily,
        groups, newGroups30, members, birthdayFlyersAll, birthdayFlyers30, groupRows, planRows,
        orderRows,
        sites, siteMembers, updates7, updates30, photos30, siteVoice30, reports30,
        leads, leads30, hot, warm, cold, handedOff,
      ] = await Promise.all([
        count("contacts"),
        count("contacts", (q) => q.gte("created_at", d7)),
        count("contacts", (q) => q.gte("created_at", d30)),
        count("messages", (q) => q.eq("direction", "inbound").gte("created_at", d7)),
        count("messages", (q) => q.eq("direction", "inbound").gte("created_at", d30)),
        count("messages", (q) => q.eq("direction", "outbound").gte("created_at", d30)),
        count("messages", (q) => q.eq("direction", "inbound").eq("type", "audio").gte("created_at", d30)),
        Promise.all(
          days.map((d) =>
            count("messages", (q) =>
              q.eq("direction", "inbound").gte("created_at", d.start.toISOString()).lt("created_at", d.end.toISOString()),
            ),
          ),
        ),
        count("flyer_groups", (q) => q.eq("active", true)),
        count("flyer_groups", (q) => q.eq("active", true).gte("created_at", d30)),
        count("flyer_members"),
        count("flyer_birthday_sends"),
        count("flyer_birthday_sends", (q) => q.gte("sent_at", d30)),
        all<{ plan: string; plan_until: string | null; active: boolean }>("flyer_groups", "plan, plan_until, active"),
        all<{ id: string; monthly_price_kobo: number | null; sort_order: number }>(
          "flyer_plans",
          "id, monthly_price_kobo, sort_order",
        ),
        all<{ status: string; total_kobo: number; paid_at: string | null }>(
          "quote_orders",
          "status, total_kobo, paid_at",
        ),
        count("site_sites", (q) => q.eq("active", true)),
        count("site_members", (q) => q.eq("active", true)),
        count("site_updates", (q) => q.gte("created_at", d7)),
        count("site_updates", (q) => q.gte("created_at", d30)),
        count("site_updates", (q) => q.eq("kind", "photo").gte("created_at", d30)),
        count("site_updates", (q) => q.eq("kind", "voice").gte("created_at", d30)),
        count("site_reports", (q) => q.gte("created_at", d30)),
        count("lead_leads"),
        count("lead_leads", (q) => q.gte("created_at", d30)),
        count("lead_leads", (q) => q.eq("temperature", "hot")),
        count("lead_leads", (q) => q.eq("temperature", "warm")),
        count("lead_leads", (q) => q.eq("temperature", "cold")),
        count("lead_leads", (q) => q.eq("status", "handed_off")),
      ]);

      // Read on its own so the page still loads before migration 0043 is run.
      const sentThisMonth = await Promise.all([
        all<{ business_number_id: string; sent: number; month: string }>("whatsapp_sent_counts", "business_number_id, sent, month"),
        all<{ phone_number_id: string | null; name: string }>("quote_businesses", "phone_number_id, name"),
        all<{ phone_number_id: string; verified_name: string | null }>("whatsapp_connections", "phone_number_id, verified_name"),
      ]).then(
        ([counts, businesses, connections]) =>
          summariseSent(counts.filter((c) => c.month === lagosMonth(now)), numbers, businesses, connections),
        (err) => {
          console.error("Messages sent per number failed to load:", err);
          return null;
        },
      );

      return {
        generatedAt: now,
        whatsapp: {
          contacts,
          newContacts7,
          newContacts30,
          inbound7,
          inbound30,
          outbound30,
          voiceNotes30,
          dailyInbound: days.map((d, i) => ({ date: d.date, count: daily[i] })),
          sentThisMonth,
        },
        flyers: summariseFlyerPlans(
          { groups, newGroups30, members, birthdayFlyersAll, birthdayFlyers30 },
          groupRows.filter((g) => g.active),
          planRows,
          now,
        ),
        quotes: summariseOrders(orderRows, now),
        site: {
          sites,
          members: siteMembers,
          updates7,
          updates30,
          photos30,
          voiceNotes30: siteVoice30,
          reports30,
        },
        leads: { total: leads, new30: leads30, hot, warm, cold, handedOff },
      };
    },
  };
}

export function summariseFlyerPlans(
  counts: Pick<DashboardStats["flyers"], "groups" | "newGroups30" | "members" | "birthdayFlyersAll" | "birthdayFlyers30">,
  groups: { plan: string; plan_until: string | null }[],
  plans: { id: string; monthly_price_kobo: number | null; sort_order: number }[],
  now: Date,
): DashboardStats["flyers"] {
  const perPlan = new Map<string, number>();
  for (const g of groups) {
    const plan = effectivePlan(g.plan, g.plan_until, now);
    perPlan.set(plan, (perPlan.get(plan) ?? 0) + 1);
  }
  const ordered = [...plans].sort((a, b) => a.sort_order - b.sort_order);
  const result: PlanCount[] = ordered.map((p) => ({
    id: p.id,
    groups: perPlan.get(p.id) ?? 0,
    monthlyPriceKobo: p.monthly_price_kobo,
  }));
  let planValueKobo = 0;
  let groupsOnRequestPrice = 0;
  let paidGroups = 0;
  for (const p of result) {
    if (p.id === "free") continue;
    paidGroups += p.groups;
    if (p.monthlyPriceKobo === null) groupsOnRequestPrice += p.groups;
    else planValueKobo += p.monthlyPriceKobo * p.groups;
  }
  return { ...counts, plans: result, paidGroups, planValueKobo, groupsOnRequestPrice };
}

export function summariseOrders(
  orders: { status: string; total_kobo: number; paid_at: string | null }[],
  now: Date,
): DashboardStats["quotes"] {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const out = { quoted: 0, confirmed: 0, paid: 0, cancelled: 0, paidKobo: 0, paid30Kobo: 0, awaitingPaymentKobo: 0 };
  for (const o of orders) {
    const total = Number(o.total_kobo);
    if (o.status === "quoted") out.quoted++;
    if (o.status === "cancelled") out.cancelled++;
    if (o.status === "confirmed") {
      out.confirmed++;
      out.awaitingPaymentKobo += total;
    }
    if (o.status === "paid") {
      out.paid++;
      out.paidKobo += total;
      if (o.paid_at && new Date(o.paid_at).getTime() >= cutoff) out.paid30Kobo += total;
    }
  }
  return out;
}

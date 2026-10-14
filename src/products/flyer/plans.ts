// The plans groups can be on, and what each one includes.
//
// To change what a plan includes, edit its block below; it goes live on the
// next deploy. Prices are NOT here: they live in the database table
// flyer_plans (Supabase > Table Editor), in kobo, so they can change without
// a deploy and payments always read them from one place.

export type PlanId = "free" | "standard" | "premium" | "deluxe";

export interface Plan {
  id: PlanId;
  label: string;
  /** Most members a group can have; null for no limit. */
  maxMembers: number | null;
  /** Most admins (people who manage the group); null for no limit. */
  maxAdmins: number | null;
  /** Design ids from themes.ts this plan can use; "all" for every design. */
  designs: string[] | "all";
  /** Change the highlight colour. */
  colour: boolean;
  /** Import members from a CSV file or Google Sheets link. */
  importList: boolean;
  /** Turn photos into branded event flyers. */
  eventFlyers: boolean;
  /** Use an uploaded picture behind birthday flyers. */
  ownBackground: boolean;
  /** Print the "Made with ..." line on flyers. */
  credit: boolean;
  /** One-line summary for the plans list. */
  summary: string;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    label: "Free",
    maxMembers: 10,
    maxAdmins: 1,
    designs: ["royal", "classic"],
    colour: false,
    importList: false,
    eventFlyers: false,
    ownBackground: false,
    credit: true,
    summary: "up to 10 members, 2 designs, 1 admin",
  },
  {
    id: "standard",
    label: "Standard",
    maxMembers: 50,
    maxAdmins: 2,
    designs: "all",
    colour: true,
    importList: true,
    eventFlyers: true,
    ownBackground: false,
    credit: true,
    summary: "up to 50 members, all designs and colours, spreadsheet import, event flyers, 2 admins",
  },
  {
    id: "premium",
    label: "Premium",
    maxMembers: 500,
    maxAdmins: 5,
    designs: "all",
    colour: true,
    importList: true,
    eventFlyers: true,
    ownBackground: true,
    credit: false,
    summary: "up to 500 members, everything in Standard, your own background, no \"Made with\" line, 5 admins",
  },
  {
    id: "deluxe",
    label: "Deluxe",
    maxMembers: null,
    maxAdmins: null,
    designs: "all",
    colour: true,
    importList: true,
    eventFlyers: true,
    ownBackground: true,
    credit: false,
    summary: "unlimited members and admins, everything in Premium, several groups or chapters",
  },
];

export const FREE = PLANS[0]!;

// Deluxe replaced the old Organisation plan (2026-10-14); old names still work.
const OLD_NAMES: Record<string, PlanId> = { organisation: "deluxe", organization: "deluxe" };

export function planById(id: string): Plan {
  const wanted = OLD_NAMES[id] ?? id;
  return PLANS.find((p) => p.id === wanted) ?? FREE;
}

/** Matches "standard", "Premium", "deluxe" (or the old "organisation") to a plan. */
export function findPlan(query: string): Plan | null {
  const q = query.trim().toLowerCase();
  const wanted = OLD_NAMES[q] ?? q;
  return PLANS.find((p) => p.id === wanted) ?? null;
}

/**
 * The plan a group gets right now: its own plan while paid up, Free once
 * it's run out. A paid plan with no end date (set by an owner) never runs out.
 */
export function currentPlan(group: { plan: string; planUntil: Date | null }, now: Date): Plan {
  const plan = planById(group.plan);
  if (plan.id !== "free" && group.planUntil && group.planUntil.getTime() <= now.getTime()) return FREE;
  return plan;
}

export function allowsDesign(plan: Plan, themeId: string): boolean {
  return plan.designs === "all" || plan.designs.includes(themeId);
}

/** The cheapest plan that has a feature, for "this is on the X plan" messages. */
export function cheapestWith(has: (p: Plan) => boolean): Plan {
  return PLANS.find(has) ?? PLANS[PLANS.length - 1]!;
}

/** ₦3,000 from 300000 kobo. Money is kept in kobo and only turned into naira for display. */
export function formatNaira(kobo: number): string {
  const naira = Math.floor(kobo / 100);
  const k = kobo % 100;
  return `₦${naira.toLocaleString("en-NG")}${k ? `.${String(k).padStart(2, "0")}` : ""}`;
}

/** A date plus a number of months, keeping the day where possible (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

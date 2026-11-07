// The plans groups can be on, and what each one includes.
//
// To change what a plan includes, edit its block below; it goes live on the
// next deploy. Prices are NOT here: they live in the database table
// flyer_plans (Supabase > Table Editor), in kobo, so they can change without
// a deploy and payments always read them from one place.

import { THEMES } from "./themes.js";

export type PlanId = "free" | "standard" | "premium" | "deluxe" | "organisation";

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
  /** The summary for French-speaking groups. */
  summaryFr: string;
}

// Which designs each plan gets. Free has four; each paid plan adds more, and
// Deluxe and Organisation get every design. A new design in themes.ts is on
// Standard unless it is listed here.
const FREE_DESIGNS = ["royal", "classic", "minimal", "retro"];
const PREMIUM_DESIGNS = ["glass", "scribble", "y2k"];
const DELUXE_DESIGNS = ["editorial", "aurora"];
const STANDARD_DESIGNS = THEMES.map((t) => t.id).filter((id) => !PREMIUM_DESIGNS.includes(id) && !DELUXE_DESIGNS.includes(id));
const PREMIUM_ALL = [...STANDARD_DESIGNS, ...PREMIUM_DESIGNS];

export const PLANS: Plan[] = [
  {
    id: "free",
    label: "Free",
    maxMembers: 10,
    maxAdmins: 1,
    designs: FREE_DESIGNS,
    colour: false,
    importList: false,
    eventFlyers: false,
    ownBackground: false,
    credit: true,
    summary: `up to 10 members, ${FREE_DESIGNS.length} designs, 1 admin`,
    summaryFr: `jusqu'à 10 membres, ${FREE_DESIGNS.length} modèles, 1 administrateur`,
  },
  {
    id: "standard",
    label: "Standard",
    maxMembers: 50,
    maxAdmins: 2,
    designs: STANDARD_DESIGNS,
    colour: true,
    importList: true,
    eventFlyers: true,
    ownBackground: false,
    credit: true,
    summary: `up to 50 members, ${STANDARD_DESIGNS.length} designs in any colour, spreadsheet import, event flyers, 2 admins`,
    summaryFr: `jusqu'à 50 membres, ${STANDARD_DESIGNS.length} modèles en toutes couleurs, import de tableur, flyers d'événement, 2 administrateurs`,
  },
  {
    id: "premium",
    label: "Premium",
    maxMembers: 500,
    maxAdmins: 5,
    designs: PREMIUM_ALL,
    colour: true,
    importList: true,
    eventFlyers: true,
    ownBackground: true,
    credit: false,
    summary: `up to 500 members, everything in Standard, ${PREMIUM_ALL.length} designs, your own background, no "Made with" line, 5 admins`,
    summaryFr: `jusqu'à 500 membres, tout Standard, ${PREMIUM_ALL.length} modèles, votre propre fond, sans la mention « Fait avec », 5 administrateurs`,
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
    summary: `unlimited members and admins, everything in Premium, all ${THEMES.length} designs, several groups or chapters`,
    summaryFr: `membres et administrateurs illimités, tout Premium, les ${THEMES.length} modèles, plusieurs groupes ou sections`,
  },
  {
    id: "organisation",
    label: "Organisation",
    maxMembers: null,
    maxAdmins: null,
    designs: "all",
    colour: true,
    importList: true,
    eventFlyers: true,
    ownBackground: true,
    credit: false,
    summary: "everything in Deluxe, for large associations with many groups or chapters, set up for you",
    summaryFr: "tout Deluxe, pour les grandes associations avec de nombreux groupes ou sections, installé pour vous",
  },
];

export const FREE = PLANS[0]!;

/**
 * The free trial every new group starts with: a paid plan's features for a
 * number of days or a number of finished flyers, whichever runs out first.
 * Then the group drops back to Free. Change the numbers here to change it.
 */
export interface Trial {
  plan: PlanId;
  days: number;
  flyers: number;
}

export const TRIAL: Trial = { plan: "standard", days: 7, flyers: 30 };

export function planById(id: string): Plan {
  return PLANS.find((p) => p.id === id) ?? FREE;
}

/** Matches "standard", "Premium", "organization" (either spelling) to a plan. */
export function findPlan(query: string): Plan | null {
  const q = query.trim().toLowerCase().replace("organization", "organisation");
  return PLANS.find((p) => p.id === q) ?? null;
}

type PlanState = { plan: string; planUntil: Date | null; trialFlyersLeft: number | null };

/**
 * The plan a group gets right now: its own plan while paid up, Free once
 * it's run out. A paid plan with no end date (set by an owner) never runs out.
 * A free trial also ends once its flyers are used up.
 */
export function currentPlan(group: PlanState, now: Date): Plan {
  const plan = planById(group.plan);
  if (plan.id !== "free" && group.planUntil && group.planUntil.getTime() <= now.getTime()) return FREE;
  if (group.trialFlyersLeft !== null && group.trialFlyersLeft <= 0) return FREE;
  return plan;
}

/** True while a group is on its free trial (not once it has ended). */
export function onTrial(group: PlanState, now: Date): boolean {
  return group.trialFlyersLeft !== null && currentPlan(group, now).id !== "free";
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

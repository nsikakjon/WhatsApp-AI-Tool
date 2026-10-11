import { formatNaira } from "../../core/money.js";

// What we know about a lead, and how hot they are. The score is worked out
// here in code from their answers, never by the AI, so the same answers always
// give the same score and it's easy to explain to an agent.

export type Purpose = "buy" | "rent";
export type Timeline = "now" | "1-3 months" | "3-6 months" | "later" | "just looking";
export type Financing = "cash" | "mortgage approved" | "payment plan" | "needs mortgage" | "unsure";
export type Temperature = "hot" | "warm" | "cold";

export const TIMELINES: Timeline[] = ["now", "1-3 months", "3-6 months", "later", "just looking"];
export const FINANCING: Financing[] = ["cash", "mortgage approved", "payment plan", "needs mortgage", "unsure"];

export interface LeadDetails {
  name: string | null;
  purpose: Purpose | null;
  propertyType: string | null;
  location: string | null;
  /** The most they can spend, in kobo (rent: per year). */
  budgetKobo: number | null;
  timeline: Timeline | null;
  financing: Financing | null;
}

export const EMPTY_DETAILS: LeadDetails = {
  name: null,
  purpose: null,
  propertyType: null,
  location: null,
  budgetKobo: null,
  timeline: null,
  financing: null,
};

/** The questions we ask, in order. Name is optional (WhatsApp usually gives it). */
export const QUESTIONS: Array<{ field: Exclude<keyof LeadDetails, "name">; ask: string }> = [
  { field: "purpose", ask: "Are you looking to buy or to rent?" },
  { field: "propertyType", ask: "What kind of property are you looking for? (e.g. 3 bedroom flat, duplex, land)" },
  { field: "location", ask: "Which area or areas would you like?" },
  { field: "budgetKobo", ask: "What's your budget? (for rent, the yearly amount)" },
  { field: "timeline", ask: "When are you hoping to move or buy? Now, in 1 to 3 months, 3 to 6 months, or later?" },
  { field: "financing", ask: "How will you pay? Cash, an approved mortgage, a payment plan, or do you still need a mortgage?" },
];

export function missingFields(d: LeadDetails): Array<(typeof QUESTIONS)[number]["field"]> {
  return QUESTIONS.filter((q) => d[q.field] === null).map((q) => q.field);
}

export function isComplete(d: LeadDetails): boolean {
  return missingFields(d).length === 0;
}

const TIMELINE_POINTS: Record<Timeline, number> = {
  now: 30,
  "1-3 months": 20,
  "3-6 months": 10,
  later: 5,
  "just looking": 0,
};

const FINANCING_POINTS: Record<Financing, number> = {
  cash: 25,
  "mortgage approved": 20,
  "payment plan": 10,
  "needs mortgage": 5,
  unsure: 0,
};

export const HOT_SCORE = 70;
export const WARM_SCORE = 40;

/**
 * 0 to 100. Timeline (up to 30) and how they'll pay (up to 25) count most,
 * then having a budget (20), a location (10), a property type (10), and
 * asking for an agent or viewing (5).
 */
export function scoreLead(d: LeadDetails, wantsAgent: boolean): { score: number; temperature: Temperature } {
  let score = 0;
  if (d.budgetKobo !== null && d.budgetKobo > 0) score += 20;
  if (d.timeline) score += TIMELINE_POINTS[d.timeline];
  if (d.financing) score += FINANCING_POINTS[d.financing];
  if (d.location) score += 10;
  if (d.propertyType) score += 10;
  if (wantsAgent) score += 5;
  const temperature = score >= HOT_SCORE ? "hot" : score >= WARM_SCORE ? "warm" : "cold";
  return { score, temperature };
}

const TEMPERATURE_LABEL: Record<Temperature, string> = { hot: "🔥 HOT", warm: "🟠 Warm", cold: "🔵 Cold" };

export function temperatureLabel(t: Temperature): string {
  return TEMPERATURE_LABEL[t];
}

/** The lead's answers as short lines, for the agent alert and the customer's summary. */
export function describeDetails(d: LeadDetails): string[] {
  const lines: string[] = [];
  if (d.purpose) lines.push(`Looking to: ${d.purpose}`);
  if (d.propertyType) lines.push(`Property: ${d.propertyType}`);
  if (d.location) lines.push(`Area: ${d.location}`);
  if (d.budgetKobo !== null) lines.push(`Budget: ${formatNaira(d.budgetKobo)}${d.purpose === "rent" ? " a year" : ""}`);
  if (d.timeline) lines.push(`When: ${d.timeline}`);
  if (d.financing) lines.push(`Paying by: ${d.financing}`);
  return lines;
}

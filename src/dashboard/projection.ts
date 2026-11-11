import type { MoneyLine } from "./profit.js";

// The Base case of the self-funded projection made on 28 Oct 2026
// (accounts/yarnoga-projection-2026-10-28.xlsx, sheet "Base"), so the money
// actually spent and received can be checked against it month by month.
// Whole naira per month, as in the spreadsheet:
//   ads      "Total advertising" (ad spend plus VAT and card costs)
//   running  Paystack fees + AI and voice notes + WhatsApp (Meta) fees + tools
//            and servers + other costs
//   income   "Total income"
// When the spreadsheet is rebuilt with real ad results, replace these rows.
const BASE_PLAN: [month: string, ads: number, running: number, income: number][] = [
  ["2026-11", 106100, 158000, 0],
  ["2026-12", 106100, 176233, 68700],
  ["2027-01", 106100, 197477, 129940],
  ["2027-02", 106100, 216605, 188399],
  ["2027-03", 106100, 233880, 244181],
  ["2027-04", 106100, 249538, 297410],
  ["2027-05", 106100, 263775, 348202],
  ["2027-06", 106100, 276763, 396670],
  ["2027-07", 106100, 288646, 442918],
  ["2027-08", 106100, 299556, 487050],
  ["2027-09", 106100, 309598, 529162],
  ["2027-10", 112288, 319971, 569346],
  ["2027-11", 120815, 331462, 611698],
  ["2027-12", 129802, 344183, 657381],
  ["2028-01", 139496, 358160, 706446],
  ["2028-02", 149908, 373445, 759179],
  ["2028-03", 161098, 390093, 815847],
  ["2028-04", 173123, 408175, 876745],
  ["2028-05", 186045, 427768, 942189],
  ["2028-06", 199932, 448961, 1012518],
  ["2028-07", 214856, 471850, 1088097],
  ["2028-08", 230894, 496550, 1169317],
  ["2028-09", 248129, 523176, 1256601],
  ["2028-10", 266651, 551862, 1350399],
];

export const PLAN_START = BASE_PLAN[0]![0];

/** Costs in this category count as ads; every other cost is a running cost. */
export const MARKETING_CATEGORY = "Marketing";

export interface Figures {
  adsKobo: number;
  runningKobo: number;
  incomeKobo: number;
  /** Income minus ads and running costs; negative is a loss. */
  netKobo: number;
}

export interface PlanMonth {
  /** "2026-11" */
  month: string;
  planned: Figures;
  /** Null for months still to come. */
  actual: Figures | null;
}

export interface PlanComparison {
  /** Plan months up to and including this one, newest first. */
  months: PlanMonth[];
  /** This month, while it is inside the plan. */
  current: PlanMonth | null;
  /** Totals from the plan's first month to this one. */
  planned: Figures;
  actual: Figures;
  /** Plan months still to come, oldest first. */
  ahead: PlanMonth[];
}

function figures(adsKobo: number, runningKobo: number, incomeKobo: number): Figures {
  return { adsKobo, runningKobo, incomeKobo, netKobo: incomeKobo - adsKobo - runningKobo };
}

function add(a: Figures, b: Figures): Figures {
  return figures(a.adsKobo + b.adsKobo, a.runningKobo + b.runningKobo, a.incomeKobo + b.incomeKobo);
}

export function isMarketing(category: string | null): boolean {
  return category?.trim().toLowerCase() === MARKETING_CATEGORY.toLowerCase();
}

/** Puts the money entries next to the plan; `month` is this month in Lagos ("2026-11"). */
export function compareWithPlan(lines: MoneyLine[], month: string): PlanComparison {
  const actual = new Map<string, Figures>();
  for (const l of lines) {
    const key = l.date.slice(0, 7);
    const m = actual.get(key) ?? figures(0, 0, 0);
    const line =
      l.kind === "income"
        ? figures(0, 0, l.amountKobo)
        : isMarketing(l.category)
          ? figures(l.amountKobo, 0, 0)
          : figures(0, l.amountKobo, 0);
    actual.set(key, add(m, line));
  }
  const all = BASE_PLAN.map(([m, ads, running, income]) => ({
    month: m,
    planned: figures(ads * 100, running * 100, income * 100),
    actual: m <= month ? (actual.get(m) ?? figures(0, 0, 0)) : null,
  }));
  const done = all.filter((m) => m.actual);
  return {
    months: [...done].reverse(),
    current: done.find((m) => m.month === month) ?? null,
    planned: done.reduce((sum, m) => add(sum, m.planned), figures(0, 0, 0)),
    actual: done.reduce((sum, m) => add(sum, m.actual!), figures(0, 0, 0)),
    ahead: all.filter((m) => !m.actual),
  };
}

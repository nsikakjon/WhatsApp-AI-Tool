import type { Hono } from "hono";
import { formatMoney } from "../../core/money.js";
import { koboToPlainNaira } from "../exports.js";
import type { SectionContext } from "../index.js";
import { esc, icon, stat } from "../layout.js";
import type { Takings } from "../store.js";
import type { Env } from "../types.js";

// Tax summary (QUOTE_TAX_SUMMARY, owners only): each month's sales added up,
// with the VAT inside them and 1% of them, so the owner or their accountant
// has the figures ready for a VAT return or the presumptive tax. Plain sums of
// what was paid; the page says it isn't tax advice.
//
// The 2026 rules it labels (Nigeria Tax Act 2025 and the Presumptive Tax
// Regulations 2026): VAT is 7.5%; presumptive tax is 1% of turnover; a nano
// business with sales up to ₦12 million, no fixed premises and no staff is
// exempt from it; a small company (sales up to ₦50 million in the Act, ₦100
// million in some government guidance, fixed assets up to ₦250 million, not
// professional services) pays 0% company tax and doesn't charge VAT.

export const NANO_LINE_KOBO = 1_200_000_000;
export const SMALL_COMPANY_LINE_KOBO = 5_000_000_000;
export const SMALL_COMPANY_GUIDANCE_KOBO = 10_000_000_000;

/** The VAT part of a price that includes 7.5% VAT: 7.5 of every 107.5, i.e. 3/43. */
export const vatInside = (kobo: number) => Math.round((kobo * 3) / 43);
export const onePercent = (kobo: number) => Math.round(kobo / 100);

export interface TaxMonth {
  /** YYYY-MM in Lagos. */
  month: string;
  ordersKobo: number;
  orders: number;
  counterKobo: number;
  counter: number;
  salesKobo: number;
  vatKobo: number;
  presumptiveKobo: number;
}

/** YYYY-MM of a moment, in Lagos (UTC+1). */
export const lagosMonthOf = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 7);

/** One row per month asked for, in that order; months with no sales show zeros. */
export function taxMonths(takings: Takings[], months: string[]): TaxMonth[] {
  const rows = new Map(months.map((month) => [month, { month, ordersKobo: 0, orders: 0, counterKobo: 0, counter: 0 }]));
  for (const t of takings) {
    const row = rows.get(lagosMonthOf(t.at));
    if (!row) continue;
    if (t.kind === "order") {
      row.ordersKobo += t.totalKobo;
      row.orders += 1;
    } else {
      row.counterKobo += t.totalKobo;
      row.counter += 1;
    }
  }
  return [...rows.values()].map((r) => {
    const salesKobo = r.ordersKobo + r.counterKobo;
    return { ...r, salesKobo, vatKobo: vatInside(salesKobo), presumptiveKobo: onePercent(salesKobo) };
  });
}

/** Adds the rows up, so the total line matches the table above it. */
export function taxTotal(rows: TaxMonth[]): Omit<TaxMonth, "month"> {
  const sum = (k: Exclude<keyof TaxMonth, "month">) => rows.reduce((t, r) => t + r[k], 0);
  return {
    ordersKobo: sum("ordersKobo"),
    orders: sum("orders"),
    counterKobo: sum("counterKobo"),
    counter: sum("counter"),
    salesKobo: sum("salesKobo"),
    vatKobo: sum("vatKobo"),
    presumptiveKobo: sum("presumptiveKobo"),
  };
}

/** The months of a year shown so far: all twelve for a past year, up to this month for this one. */
export function yearMonths(year: number, at: Date): string[] {
  const now = lagosMonthOf(at);
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= now);
}

/** First moment of a YYYY-MM month in Lagos. */
const monthStart = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1, -1));

const monthName = (month: string) => monthStart(month).toLocaleDateString("en-GB", { month: "long", timeZone: "Africa/Lagos" });

export function taxCsv(rows: TaxMonth[]): string {
  const total = taxTotal(rows);
  const line = (label: string, r: Omit<TaxMonth, "month">) =>
    [label, koboToPlainNaira(r.ordersKobo), koboToPlainNaira(r.counterKobo), koboToPlainNaira(r.salesKobo), koboToPlainNaira(r.vatKobo), koboToPlainNaira(r.presumptiveKobo)].join(",");
  return [
    "Month,WhatsApp and shop orders paid (NGN),Counter sales (NGN),Total sales (NGN),VAT inside at 7.5% (NGN),1% of sales (NGN)",
    ...rows.map((r) => line(r.month, r)),
    line("Total", total),
  ].join("\r\n") + "\r\n";
}

export function registerTax(app: Hono<Env>, ctx: SectionContext) {
  app.use("/tax", async (c, next) => (c.get("biz").tax ? ((await ctx.ownerOnly(c)) ?? next()) : c.notFound()));
  app.use("/tax/*", async (c, next) => (c.get("biz").tax ? ((await ctx.ownerOnly(c)) ?? next()) : c.notFound()));

  const yearAsked = (text: string | undefined, at: Date) => {
    const now = Number(lagosMonthOf(at).slice(0, 4));
    const y = Number(text);
    return Number.isInteger(y) && y >= 2024 && y <= now ? y : now;
  };

  app.get("/tax", async (c) => {
    const biz = c.get("biz");
    if (biz.currency !== "NGN") {
      return ctx.render(c, "Tax summary", "/home/tax", `<p>The tax summary follows Nigeria's tax rules, so it's only for businesses whose prices are in naira.</p>`);
    }
    const at = ctx.now();
    const year = yearAsked(c.req.query("year"), at);
    const months = yearMonths(year, at);
    const current = lagosMonthOf(at);
    // This month and the eleven before it.
    const rollingFrom = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 12, 1, -1));
    const yearFrom = monthStart(`${year}-01`);
    const from = yearFrom < rollingFrom ? yearFrom : rollingFrom;
    const takings = await biz.tax!.takings(from, at);

    const rows = taxMonths(takings, months);
    const total = taxTotal(rows);
    const rolling = takings.filter((t) => t.at >= rollingFrom).reduce((s, t) => s + t.totalKobo, 0);
    const money = (k: number) => formatMoney(k, "NGN");
    const n = (x: number) => x.toLocaleString("en-NG");

    const table = `<div class="scroll"><table><tr><th>Month</th><th>Orders paid</th><th>Counter sales</th><th>Total sales</th><th>VAT inside (7.5%)</th><th>1% of sales</th></tr>
${rows
  .map(
    (r) =>
      `<tr><td>${monthName(r.month)}${r.month === current ? ' <span class="muted small">so far</span>' : ""}</td><td>${money(r.ordersKobo)}<br><span class="muted small">${n(r.orders)} order${r.orders === 1 ? "" : "s"}</span></td><td>${money(r.counterKobo)}<br><span class="muted small">${n(r.counter)} sale${r.counter === 1 ? "" : "s"}</span></td><td><b>${money(r.salesKobo)}</b></td><td>${money(r.vatKobo)}</td><td>${money(r.presumptiveKobo)}</td></tr>`,
  )
  .reverse()
  .join("")}
<tr><th>${year}</th><th>${money(total.ordersKobo)}</th><th>${money(total.counterKobo)}</th><th>${money(total.salesKobo)}</th><th>${money(total.vatKobo)}</th><th>${money(total.presumptiveKobo)}</th></tr></table></div>`;

    const line = (kobo: number, text: string) =>
      `<li><div class="rankrow"><b>${money(kobo)}</b><span class="tag ${rolling > kobo ? "amber" : "lime"}">You're ${rolling > kobo ? "over" : "under"}</span></div><p class="muted small" style="margin:4px 0 0">${text}</p></li>`;

    const nowYear = Number(current.slice(0, 4));
    const years = `<p class="small">${year > 2024 ? `<a href="/home/tax?year=${year - 1}">${year - 1}</a>` : ""}${year < nowYear ? ` · <a href="/home/tax?year=${year + 1}">${year + 1}</a>` : ""}</p>`;

    const body = `<p>Your sales each month, added up for VAT and the 1% presumptive tax. These are your numbers from yarnOga, not tax advice: check with your accountant or the Nigeria Revenue Service (NRS) before you file or pay.</p>
<div class="grid">
${stat(`Sales in ${year}`, money(total.salesKobo), `${n(total.orders)} orders · ${n(total.counter)} counter sales`, { glow: true, icon: "prices" })}
${stat("Last 12 months", money(rolling), "the figure the tax lines below use", { icon: "orders" })}
</div>
<section class="card" style="margin-top:14px">
  <div class="cardhead"><h3>Month by month</h3><a class="button ghost small" href="/home/tax/sales-${year}.csv">${icon("export", 16)}Download CSV</a></div>
  ${table}
  ${years}
</section>
<div class="split even" style="margin-top:14px">
  <section class="card">
    <h3>How these are worked out</h3>
    <p class="small"><b>Total sales</b> are orders marked paid (by pay link or by you), in the month they were paid and including delivery fees, plus counter sales. Quotes, unpaid orders and cancelled counter sales don't count.</p>
    <p class="small"><b>VAT inside</b> is for a business registered for VAT whose prices include it: 7.5 of every 107.5 is VAT. VAT you paid on your own supplies comes off before you pay. The return is due by the 21st of the next month.</p>
    <p class="small"><b>1% of sales</b> is the presumptive tax, for a business that doesn't keep full accounts. It's worked out on a year's sales.</p>
  </section>
  <section class="card">
    <h3>Lines in the 2026 tax rules</h3>
    <ul class="rank">
      ${line(NANO_LINE_KOBO, "Up to this a year, with no fixed shop and no staff, the 1% presumptive tax doesn't apply.")}
      ${line(SMALL_COMPANY_LINE_KOBO, "The Nigeria Tax Act 2025's small company line, with fixed assets up to ₦250 million: 0% company tax and no VAT to charge. Professional services never count as small.")}
      ${line(SMALL_COMPANY_GUIDANCE_KOBO, "Some 2026 government guidance puts the small company line here instead. Ask NRS or your accountant which one applies to you.")}
    </ul>
  </section>
</div>`;
    return ctx.render(c, "Tax summary", "/home/tax", body);
  });

  app.get("/tax/:file{sales-[0-9]{4}\\.csv}", async (c) => {
    const biz = c.get("biz");
    if (biz.currency !== "NGN") return c.notFound();
    const at = ctx.now();
    const year = yearAsked(c.req.param("file").slice(6, 10), at);
    const months = yearMonths(year, at);
    const takings = await biz.tax!.takings(monthStart(`${year}-01`), at < monthStart(`${year + 1}-01`) ? at : monthStart(`${year + 1}-01`));
    return c.body(taxCsv(taxMonths(takings, months)), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sales-for-tax-${year}.csv"` });
  });
}

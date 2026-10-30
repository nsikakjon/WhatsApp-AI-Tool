import type { Hono } from "hono";
import { formatMoney, type Currency } from "../../core/money.js";
import { quoteLine, quoteTotal, type QuoteLine } from "../../products/quote/pricing.js";
import type { SectionContext } from "../index.js";
import { esc, field, icon } from "../layout.js";
import { PAID_BY, type CounterSale, type PaidBy, type ProductOption, type ProductRecord, type SoldLine } from "../store.js";
import type { AppContext, Env } from "../types.js";
import { lagosMidnight } from "./tools.js";

// Counter sales (QUOTE_COUNTER_SALES): staff tap what a walk-in shopper
// bought, check the total and confirm. The sale is recorded and taken off the
// stock in one step, so the stock count stays right when not every sale comes
// through WhatsApp. Prices come from the price list, worked out by the same
// code as the bot's quotes. Cost prices on the price list give each sale its
// profit.

const UUID = /^[0-9a-f-]{36}$/;
const MAX_QUANTITY = 100_000;

export const PAID_BY_LABEL: Record<PaidBy, string> = { cash: "Cash", transfer: "Transfer", pos: "POS" };

/** A price list option that can be rung up: it has a price. */
interface Sellable {
  variantId: string;
  name: string;
  option: ProductOption;
}

function sellables(products: ProductRecord[]): Sellable[] {
  return products.flatMap((p) =>
    p.options.filter((o) => o.id && o.tiers.length).map((o) => ({ variantId: o.id!, name: `${p.name}: ${o.name}`, option: o })),
  );
}

/** The quantities typed or tapped in, from fields named q_<option id>. */
export function pickedQuantities(form: Record<string, unknown>): { picked: Map<string, number>; problems: string[] } {
  const picked = new Map<string, number>();
  const problems: string[] = [];
  for (const [key, value] of Object.entries(form)) {
    const id = key.startsWith("q_") ? key.slice(2) : "";
    if (!UUID.test(id)) continue;
    const text = String(value).trim().replace(/,/g, "");
    if (!text || text === "0") continue;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) problems.push(`"${text}" isn't a number of pieces.`);
    else picked.set(id, n);
  }
  return { picked, problems };
}

/** Prices the picked items from the price list, or says what's wrong. */
export function priceSale(products: ProductRecord[], picked: Map<string, number>, currency: Currency = "NGN"): { lines: QuoteLine[]; problems: string[] } {
  const byId = new Map(sellables(products).map((s) => [s.variantId, s]));
  const lines: QuoteLine[] = [];
  const problems: string[] = [];
  for (const [id, quantity] of picked) {
    const item = byId.get(id);
    if (!item) {
      problems.push("Something you picked is no longer on the price list. Please pick again.");
      continue;
    }
    const { option } = item;
    if (option.stock !== null && quantity > option.stock) {
      problems.push(option.stock ? `${item.name}: only ${option.stock} left.` : `${item.name} is sold out.`);
      continue;
    }
    const priced = quoteLine({ id, name: item.name, minQuantity: option.minQuantity, tiers: option.tiers }, quantity);
    if (priced.ok) lines.push(priced.line);
    else if (priced.reason === "below_minimum") problems.push(`${item.name}: the smallest sale is ${priced.minQuantity}.`);
    else problems.push(`${item.name}: no price for ${quantity} on the price list.`);
  }
  if (!picked.size && !problems.length) problems.push("Tap + next to what the customer is buying.");
  return { lines, problems: [...new Set(problems)] };
}

/** A sale's profit after its discount; null when a line has no cost price. */
export function saleProfit(lines: SoldLine[], discountKobo = 0): number | null {
  let profit = -discountKobo;
  for (const l of lines) {
    if (l.unitCostKobo === null) return null;
    profit += l.totalKobo - l.unitCostKobo * l.quantity;
  }
  return profit;
}

export interface ProfitSummary {
  profitKobo: number;
  /** What the counted sales took, after discounts. */
  salesKobo: number;
  counted: number;
  /** Sales left out because something on them has no cost price. */
  missing: number;
}

export function profitSummary(sales: Array<{ lines: SoldLine[]; discountKobo?: number }>): ProfitSummary {
  const sum: ProfitSummary = { profitKobo: 0, salesKobo: 0, counted: 0, missing: 0 };
  for (const s of sales) {
    const profit = saleProfit(s.lines, s.discountKobo);
    if (profit === null) {
      sum.missing++;
      continue;
    }
    sum.counted++;
    sum.profitKobo += profit;
    sum.salesKobo += s.lines.reduce((t, l) => t + l.totalKobo, 0) - (s.discountKobo ?? 0);
  }
  return sum;
}

/** Profit per product (before order discounts), most profit first. Lines without a cost price are left out. */
export function profitByProduct(lines: SoldLine[], limit: number): Array<{ name: string; quantity: number; salesKobo: number; profitKobo: number }> {
  const totals = new Map<string, { name: string; quantity: number; salesKobo: number; profitKobo: number }>();
  for (const l of lines) {
    if (l.unitCostKobo === null) continue;
    const t = totals.get(l.name) ?? { name: l.name, quantity: 0, salesKobo: 0, profitKobo: 0 };
    t.quantity += l.quantity;
    t.salesKobo += l.totalKobo;
    t.profitKobo += l.totalKobo - l.unitCostKobo * l.quantity;
    totals.set(l.name, t);
  }
  return [...totals.values()].sort((a, b) => b.profitKobo - a.profitKobo).slice(0, limit);
}

/** Money that can be below zero: a sale under cost is a loss. */
export function signedMoney(minor: number, currency: Currency): string {
  return minor < 0 ? `-${formatMoney(-minor, currency)}` : formatMoney(minor, currency);
}

const lagosToday = (at: Date) => lagosMidnight(new Date(at.getTime() + 3_600_000).toISOString().slice(0, 10))!;
const lagosTime = (at: Date) => at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

export function registerCounter(app: Hono<Env>, ctx: SectionContext) {
  const guard = async (c: AppContext, next: () => Promise<void>) => {
    if (!c.get("biz").counter) return ctx.render(c, "Counter sale", "/home/counter", `<p>Counter sales aren't switched on for your business yet.</p>`, 404);
    return (await ctx.need(c, "counter")) ?? next();
  };
  app.use("/counter", guard);
  app.use("/counter/*", guard);

  const readPaidBy = (form: Record<string, unknown>): PaidBy => {
    const v = field(form, "paid", 10);
    return (PAID_BY as readonly string[]).includes(v) ? (v as PaidBy) : "cash";
  };

  const hidden = (picked: Map<string, number>, paidBy: PaidBy) =>
    [...picked].map(([id, n]) => `<input type="hidden" name="q_${id}" value="${n}">`).join("") + `<input type="hidden" name="paid" value="${paidBy}">`;

  /** The screen to tap items on, with today's sales under it. */
  async function picker(c: AppContext, picked = new Map<string, number>(), paidBy: PaidBy = "cash", problems: string[] = []) {
    const biz = c.get("biz");
    const money = (minor: number) => formatMoney(minor, biz.currency);
    const items = sellables(await biz.prices.products());
    const rows = items
      .map((s) => {
        const o = s.option;
        const price = o.tiers.map((t, i) => (i === 0 ? `${money(t.unitPriceKobo)} each` : `${money(t.unitPriceKobo)} from ${t.minQuantity}`)).join(", ");
        const soldOut = o.stock === 0;
        const notes = [price, o.minQuantity > 1 ? `smallest sale ${o.minQuantity}` : "", o.stock !== null ? (soldOut ? "sold out" : `${o.stock} left`) : ""].filter(Boolean);
        return `<div class="sellable" data-name="${esc(s.name.toLowerCase())}"><div style="min-width:0"><b>${esc(s.name)}</b><p class="muted small" style="margin:0">${esc(notes.join(" · "))}</p></div>
<div class="qty"><button type="button" class="ghost small" data-step="-1" aria-label="One less"${soldOut ? " disabled" : ""}>${icon("minus", 16)}</button><input name="q_${s.variantId}" inputmode="numeric" value="${picked.get(s.variantId) ?? ""}" aria-label="How many ${esc(s.name)}"${soldOut ? " disabled" : ""}><button type="button" class="small" data-step="1" aria-label="One more"${soldOut ? " disabled" : ""}>${icon("plus", 16)}</button></div></div>`;
      })
      .join("");
    const paid = PAID_BY.map(
      (p) => `<label class="check" style="margin:0"><input type="radio" name="paid" value="${p}"${p === paidBy ? " checked" : ""}> ${PAID_BY_LABEL[p]}</label>`,
    ).join("");
    const body = `${problems.length ? `<div class="flash bad"><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
${
  items.length
    ? `<form method="post" action="/home/counter/check">
<input type="search" id="find" placeholder="Search products" aria-label="Search products" autocomplete="off">
<div class="sellables">${rows}</div>
<p style="margin:16px 0 6px"><b>Paid by</b></p><div style="display:flex;gap:20px;flex-wrap:wrap">${paid}</div>
<div class="actions"><button>Check the total</button><span class="muted small" id="picked"></span></div>
</form>
<script>
(function () {
  var form = document.currentScript.previousElementSibling;
  function count() {
    var n = 0;
    form.querySelectorAll(".qty input").forEach(function (i) { n += parseInt(i.value, 10) || 0; });
    document.getElementById("picked").textContent = n ? n + (n === 1 ? " piece picked" : " pieces picked") : "";
  }
  form.querySelectorAll("[data-step]").forEach(function (b) {
    b.addEventListener("click", function () {
      var input = b.parentElement.querySelector("input");
      var n = Math.max(0, (parseInt(input.value, 10) || 0) + Number(b.dataset.step));
      input.value = n || "";
      count();
    });
  });
  form.addEventListener("input", count);
  document.getElementById("find").addEventListener("input", function (e) {
    var q = e.target.value.trim().toLowerCase();
    form.querySelectorAll(".sellable").forEach(function (row) { row.hidden = q !== "" && row.dataset.name.indexOf(q) < 0; });
  });
  count();
})();
</script>`
    : `<p class="muted">Nothing on your price list has a price yet.${ctx.can(c, "edit_prices") ? ` <a href="/home/prices">Add prices</a> first.` : ""}</p>`
}
${await todaysSales(c)}`;
    return ctx.render(c, "Counter sale", "/home/counter", body, problems.length ? 400 : 200);
  }

  async function todaysSales(c: AppContext): Promise<string> {
    const biz = c.get("biz");
    const money = (minor: number) => formatMoney(minor, biz.currency);
    const at = ctx.now();
    const sales: CounterSale[] = await biz.counter!.sales(lagosToday(at), new Date(at.getTime() + 60_000));
    if (!sales.length) return `<h2>Today's sales</h2><p class="muted">No counter sales yet today.</p>`;
    const seesMoney = ctx.can(c, "money");
    const kept = sales.filter((s) => !s.voided);
    const byMethod = PAID_BY.map((p) => [p, kept.filter((s) => s.paidBy === p).reduce((t, s) => t + s.totalKobo, 0)] as const).filter(([, v]) => v > 0);
    const profit = profitSummary(kept);
    const summary = seesMoney
      ? `<p>${kept.length} sale${kept.length === 1 ? "" : "s"} · <b>${money(kept.reduce((t, s) => t + s.totalKobo, 0))}</b>${byMethod.length ? ` (${byMethod.map(([p, v]) => `${PAID_BY_LABEL[p]} ${money(v)}`).join(" · ")})` : ""}${profit.counted ? ` · profit <b>${signedMoney(profit.profitKobo, biz.currency)}</b>` : ""}</p>${profit.missing ? `<p class="muted small">${profit.missing} sale${profit.missing === 1 ? " has" : "s have"} something without a cost price, so ${profit.missing === 1 ? "it isn't" : "they aren't"} in the profit. Add cost prices on the price list.</p>` : ""}`
      : "";
    const rows = sales
      .map((s) => {
        const p = saleProfit(s.lines);
        const items = s.lines.map((l) => `${l.quantity} x ${l.name}`).join(", ");
        return `<tr${s.voided ? ' class="muted" style="text-decoration:line-through"' : ""}><td>${lagosTime(s.at)}</td><td>${esc(items)}${s.voided ? ' <span class="tag red">cancelled</span>' : ""}</td><td>${PAID_BY_LABEL[s.paidBy]}</td><td>${money(s.totalKobo)}</td>${
          seesMoney ? `<td>${p === null ? '<span class="muted small">no cost price</span>' : signedMoney(p, biz.currency)}</td>` : ""
        }<td class="muted small">${esc(s.soldBy ?? "")}</td>${
          seesMoney ? `<td>${s.voided ? "" : `<form method="post" action="/home/counter/${s.id}/cancel" onsubmit="return confirm('Cancel this sale and put its items back in stock?')"><button class="danger small">Cancel</button></form>`}</td>` : ""
        }</tr>`;
      })
      .join("");
    return `<h2>Today's sales</h2>${summary}<div class="scroll"><table><tr><th>Time</th><th>Items</th><th>Paid by</th><th>Total</th>${seesMoney ? "<th>Profit</th>" : ""}<th>By</th>${seesMoney ? "<th></th>" : ""}</tr>${rows}</table></div>`;
  }

  /** The priced sale to confirm. `note` explains why it's shown again. */
  function review(c: AppContext, lines: QuoteLine[], picked: Map<string, number>, paidBy: PaidBy, note = "") {
    const biz = c.get("biz");
    const money = (minor: number) => formatMoney(minor, biz.currency);
    const total = quoteTotal(lines);
    const rows = lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${l.quantity}</td><td>${money(l.unitPriceKobo)}</td><td>${money(l.totalKobo)}</td></tr>`).join("");
    return ctx.render(
      c,
      "Check the sale",
      "/home/counter",
      `${note ? `<p class="flash bad">${esc(note)}</p>` : ""}
<div class="card"><div class="scroll"><table><tr><th>Item</th><th>How many</th><th>Price each</th><th>Total</th></tr>${rows}
<tr><td colspan="3"><b>Total to collect</b></td><td><b>${money(total)}</b></td></tr></table></div>
<p class="muted" style="margin:12px 0 0">Paid by ${PAID_BY_LABEL[paidBy]}</p></div>
<form method="post" action="/home/counter/sell">${hidden(picked, paidBy)}<input type="hidden" name="key" value="${crypto.randomUUID()}"><input type="hidden" name="total" value="${total}">
<div class="actions"><button>Confirm sale</button><button class="ghost" formaction="/home/counter">Change</button></div></form>
<p class="muted small">Confirming takes these items off your stock.</p>`,
    );
  }

  async function read(c: AppContext) {
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    const { picked, problems } = pickedQuantities(form);
    return { form, picked, problems, paidBy: readPaidBy(form) };
  }

  app.get("/counter", (c) => picker(c));
  // "Change" on the check page comes back here with what was picked.
  app.post("/counter", async (c) => {
    const { picked, paidBy } = await read(c);
    return picker(c, picked, paidBy);
  });

  app.post("/counter/check", async (c) => {
    const { picked, problems, paidBy } = await read(c);
    const priced = priceSale(await c.get("biz").prices.products(), picked, c.get("biz").currency);
    const all = [...problems, ...priced.problems];
    if (all.length) return picker(c, picked, paidBy, all);
    return review(c, priced.lines, picked, paidBy);
  });

  app.post("/counter/sell", async (c) => {
    const biz = c.get("biz");
    const { form, picked, problems, paidBy } = await read(c);
    const key = field(form, "key", 36);
    if (!UUID.test(key)) return c.redirect("/home/counter?msg=bad", 303);
    const priced = priceSale(await biz.prices.products(), picked, biz.currency);
    const all = [...problems, ...priced.problems];
    if (all.length) return picker(c, picked, paidBy, all);
    // The price list changed after the total was shown: show the new total first.
    if (String(quoteTotal(priced.lines)) !== field(form, "total", 20)) {
      return review(c, priced.lines, picked, paidBy, "A price changed since you checked. Here is the new total.");
    }
    const result = await biz.counter!.sell({ key, userId: c.get("user").id, paidBy, lines: priced.lines });
    if (!result.ok) {
      const why = result.reason === "short" ? `${result.item}: only ${result.left} left. Someone may have just sold some.` : "Something on this sale is no longer on the price list. Please pick again.";
      return picker(c, picked, paidBy, [why]);
    }
    if (!result.duplicate) ctx.log.info(`Owner app: ${biz.name} counter sale ${quoteTotal(priced.lines)} (${priced.lines.length} lines)`);
    return c.redirect("/home/counter?msg=sold", 303);
  });

  // Owners and managers can cancel a sale rung up by mistake; cashiers ask them.
  app.post("/counter/:id/cancel", async (c) => {
    const denied = await ctx.need(c, "money");
    if (denied) return denied;
    const id = c.req.param("id");
    const done = UUID.test(id) && (await c.get("biz").counter!.void(id, c.get("user").id));
    return c.redirect(`/home/counter?msg=${done ? "sale_cancelled" : "bad"}`, 303);
  });
}

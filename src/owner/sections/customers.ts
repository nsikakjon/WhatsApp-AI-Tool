import type { Hono } from "hono";
import { formatMoney } from "../../core/money.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { csvCell, koboToPlainNaira } from "../exports.js";
import type { SectionContext } from "../index.js";
import { esc, initials, stat } from "../layout.js";
import type { CustomerSummary } from "../store.js";
import type { Env } from "../types.js";
import { when } from "./inbox.js";

// Customers: everyone who has confirmed an order in the last year, with how
// many orders, how much they've paid, when they last ordered and their
// rating. Biggest spenders first, so the owner knows who to look after (and
// who to send a broadcast to). Owners can download the list as a spreadsheet.

export function customersCsv(list: CustomerSummary[]): string {
  const rows = [["Name", "WhatsApp", "Orders", "Paid", "Last order", "Rating"].join(",")];
  for (const c of list) {
    rows.push(
      [c.name ?? "", showWaId(c.waId), String(c.orders), koboToPlainNaira(c.spentKobo), c.lastOrderAt.toISOString().slice(0, 10), c.rating === null ? "" : String(c.rating)]
        .map(csvCell)
        .join(","),
    );
  }
  // A byte-order mark first, so Excel shows names with accents correctly.
  return `﻿${rows.join("\r\n")}\r\n`;
}

export function registerCustomers(app: Hono<Env>, ctx: SectionContext) {
  app.get("/customers", async (c) => {
    const biz = c.get("biz");
    const money = (minor: number) => formatMoney(minor, biz.currency);
    if (biz.features && !(await biz.features.has("customers_page"))) {
      return ctx.render(c, "Customers", "/app/customers", `<p>The customer list comes with Pro and above. Send <b>plan</b> to your bot on WhatsApp to upgrade.</p>`);
    }
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 60);
    let list: CustomerSummary[];
    try {
      list = biz.data.customers ? await biz.data.customers() : [];
    } catch (err) {
      ctx.log.error("Owner app customers:", err);
      return ctx.render(c, "Customers", "/app/customers", `<p class="flash bad">The customer list couldn't load just now. If this is new, yarnOga support may need to finish an update (migration 0054).</p>`);
    }
    const shown = q ? list.filter((x) => (x.name ?? "").toLowerCase().includes(q) || x.waId.includes(q.replace(/\D/g, "") || "~")) : list;
    const total = list.reduce((s, x) => s + x.spentKobo, 0);
    const repeat = list.filter((x) => x.orders > 1).length;
    const now = ctx.now();
    const owner = c.get("user").role === "owner";
    const rows = shown
      .slice(0, 300)
      .map(
        (x) => `<tr><td><div class="who"><span class="avatar sm">${esc(x.name ? initials(x.name) : "?")}</span><div><b>${esc(x.name ?? "No name")}</b><br><span class="muted small">${esc(showWaId(x.waId))}</span></div></div></td>
<td>${x.orders}</td><td>${money(x.spentKobo)}</td><td>${esc(when(x.lastOrderAt, now))}</td><td>${x.rating === null ? `<span class="muted">–</span>` : `${x.rating.toFixed(1)} ★`}</td>
<td><a class="small" href="/app/inbox/${esc(x.contactId)}">Chat</a></td></tr>`,
      )
      .join("");
    return ctx.render(
      c,
      "Customers",
      "/app/customers",
      `<div class="grid">
${stat("Customers this year", list.length.toLocaleString("en-NG"), "who confirmed an order", { icon: "users" })}
${stat("Came back for more", repeat.toLocaleString("en-NG"), `${list.length ? Math.round((repeat * 100) / list.length) : 0}% ordered more than once`, { icon: "orders" })}
${stat("Paid in by them", money(total), "in the last 12 months", { icon: "prices", glow: true })}
</div>
<div class="toolbar" style="margin-top:20px"><form method="get" class="search"><input name="q" value="${esc(q)}" placeholder="Search by name or number" aria-label="Search customers"><button class="ghost">Search</button></form>
${owner && list.length ? `<a class="button ghost" href="/app/customers.csv">Download spreadsheet</a>` : ""}</div>
<div class="scroll"><table><tr><th>Customer</th><th>Orders</th><th>Paid</th><th>Last order</th><th>Rating</th><th></th></tr>${rows || `<tr><td colspan="6" class="muted">${q ? "No customer matches that." : "No orders yet this year. Customers show here once they confirm an order."}</td></tr>`}</table></div>
${shown.length > 300 ? `<p class="muted small">Showing the top 300. Search to find someone else.</p>` : ""}`,
    );
  });

  app.get("/customers.csv", async (c) => {
    const denied = await ctx.ownerOnly(c);
    if (denied) return denied;
    const biz = c.get("biz");
    if (biz.features && !(await biz.features.has("customers_page"))) return c.redirect("/app/customers");
    const list = biz.data.customers ? await biz.data.customers() : [];
    return c.body(customersCsv(list), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${biz.orderPrefix.toLowerCase()}-customers.csv"`,
    });
  });
}

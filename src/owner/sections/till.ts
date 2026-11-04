import type { Hono } from "hono";
import { mark } from "../../core/brand.js";
import { quoteLine } from "../../products/quote/pricing.js";
import type { SectionContext } from "../index.js";
import { doc, icon } from "../layout.js";
import { BARCODE_KEY_JS, barcodeKey, scannerBox } from "../scanner.js";
import { PAID_BY, type OfflineSale, type PaidBy, type ProductRecord } from "../store.js";
import type { Env } from "../types.js";
import { MAX_QUANTITY, PAID_BY_LABEL, sellables, UUID } from "./counter.js";

// The offline till (OWNER_APP_OFFLINE, needs QUOTE_COUNTER_SALES and
// migration 0070). The till page is installed on the shop's computer or
// phone like an app. It keeps a copy of the price list on the device, so
// staff can ring up sales while the internet is down; each sale waits on the
// device and is sent when the connection is back. The sale's key is made on
// the till, so a sale sent twice is recorded once.
//
// Prices on the till come from the price list (its last copy). When a sale
// arrives, the price it was charged is checked against the price list now, and
// any difference is shown to the owner. Stock is never a reason to refuse an
// offline sale: the customer has already left with the goods.

const MAX_LINES = 200;
const MAX_SALES_PER_SYNC = 100;
/** A till's clock can be a little ahead; further than this is treated as wrong. */
const CLOCK_SLACK_MS = 10 * 60_000;

/** What the till sends for one sale. Everything in it is checked here. */
export interface TillSale {
  key?: unknown;
  businessId?: unknown;
  userId?: unknown;
  at?: unknown;
  paidBy?: unknown;
  lines?: unknown;
}

/**
 * Turns a sale from the till into one to record, or says why it can't be.
 * The till's prices are kept (that's what the customer paid); `listPriceKobo`
 * is set where the price list now says something else.
 */
export function readTillSale(
  raw: TillSale,
  products: ProductRecord[],
  now: Date,
): { ok: true; sale: Omit<OfflineSale, "userId"> } | { ok: false; reason: string } {
  const key = typeof raw.key === "string" ? raw.key : "";
  if (!UUID.test(key)) return { ok: false, reason: "The sale has no proper key." };
  const paidBy = PAID_BY.find((p) => p === raw.paidBy);
  if (!paidBy) return { ok: false, reason: "How it was paid is missing." };
  const at = new Date(typeof raw.at === "string" ? raw.at : NaN);
  if (!Number.isFinite(at.getTime())) return { ok: false, reason: "The time of the sale is missing." };
  // A till whose clock runs fast would put sales in the future.
  const soldAt = at.getTime() > now.getTime() + CLOCK_SLACK_MS ? now : at;

  if (!Array.isArray(raw.lines) || !raw.lines.length || raw.lines.length > MAX_LINES) return { ok: false, reason: "The sale has no items." };
  const byId = new Map(sellables(products).map((s) => [s.variantId, s]));
  const seen = new Set<string>();
  const lines: OfflineSale["lines"] = [];
  for (const l of raw.lines as Array<Record<string, unknown>>) {
    const id = typeof l?.id === "string" ? l.id : "";
    const quantity = l?.quantity;
    const unit = l?.unitPriceKobo;
    if (!UUID.test(id) || seen.has(id)) return { ok: false, reason: "An item on the sale isn't right." };
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return { ok: false, reason: "A quantity on the sale isn't right." };
    if (typeof unit !== "number" || !Number.isSafeInteger(unit) || unit < 0 || !Number.isSafeInteger(unit * quantity)) return { ok: false, reason: "A price on the sale isn't right." };
    seen.add(id);
    const item = byId.get(id);
    let listPriceKobo: number | null = null;
    if (item) {
      const now = quoteLine({ id, name: item.name, minQuantity: item.option.minQuantity, tiers: item.option.tiers }, quantity);
      if (now.ok && now.line.unitPriceKobo !== unit) listPriceKobo = now.line.unitPriceKobo;
    }
    // An item removed from the price list since keeps the name the till had.
    const name = item?.name ?? (typeof l.name === "string" && l.name.trim() ? l.name.trim().slice(0, 150) : "Removed item");
    lines.push({ variantId: id, name, quantity, unitPriceKobo: unit, totalKobo: unit * quantity, listPriceKobo });
  }
  return { ok: true, sale: { key, paidBy: paidBy as PaidBy, soldAt, lines } };
}

/** The till's own files, served without a login so the till opens offline. */
export function registerTillAssets(app: Hono<Env>) {
  app.get("/till", (c) => c.html(tillPage(), 200, { "Cache-Control": "no-cache" }));
  app.get("/sw.js", (c) => c.body(SERVICE_WORKER, 200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" }));
  app.get("/manifest.webmanifest", (c) =>
    c.body(JSON.stringify(MANIFEST), 200, { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=86400" }),
  );
}

/** The price list copy and the sending of sales, for whoever is logged in. */
export function registerTill(app: Hono<Env>, ctx: SectionContext) {
  app.get("/till/data", async (c) => {
    const biz = c.get("biz");
    const user = c.get("user");
    if (!biz.counter?.sellOffline) return c.json({ error: "off" }, 404);
    if (!ctx.can(c, "counter")) return c.json({ error: "role" }, 403);
    const items = sellables(await biz.prices.products()).map((s) => ({
      id: s.variantId,
      name: s.name,
      min: s.option.minQuantity,
      stock: s.option.stock,
      barcode: biz.barcodes && s.option.barcode ? barcodeKey(s.option.barcode) : null,
      tiers: s.option.tiers.map((t) => [t.minQuantity, t.unitPriceKobo]),
    }));
    return c.json({
      businessId: biz.id,
      businessName: biz.name,
      userId: user.id,
      currency: biz.currency,
      barcodes: Boolean(biz.barcodes),
      paidBy: PAID_BY.map((p) => [p, PAID_BY_LABEL[p]]),
      items,
      at: ctx.now().toISOString(),
    });
  });

  app.post("/till/sync", async (c) => {
    const biz = c.get("biz");
    const user = c.get("user");
    if (!biz.counter?.sellOffline) return c.json({ error: "off" }, 404);
    if (!ctx.can(c, "counter")) return c.json({ error: "role" }, 403);
    const body = (await c.req.json().catch(() => null)) as { sales?: unknown } | null;
    if (!Array.isArray(body?.sales) || body.sales.length > MAX_SALES_PER_SYNC) return c.json({ error: "bad" }, 400);
    const products = await biz.prices.products();
    const now = ctx.now();
    // The person who rang the sale up, if they work here; else whoever is sending it.
    const sellers = new Map<string, string>([[user.id, user.id]]);
    const seller = async (id: unknown) => {
      if (typeof id !== "string" || !UUID.test(id)) return user.id;
      if (!sellers.has(id)) {
        const who = await ctx.deps.users.get(id);
        sellers.set(id, who && who.businessId === biz.id ? who.id : user.id);
      }
      return sellers.get(id)!;
    };
    const results: Array<{ key: string; status: "saved" | "duplicate" | "refused" | "other_business"; reason?: string }> = [];
    let saved = 0;
    for (const raw of body.sales as TillSale[]) {
      const key = typeof raw?.key === "string" ? raw.key.slice(0, 36) : "";
      if (raw?.businessId !== biz.id) {
        results.push({ key, status: "other_business" });
        continue;
      }
      const read = readTillSale(raw, products, now);
      if (!read.ok) {
        results.push({ key, status: "refused", reason: read.reason });
        continue;
      }
      const done = await biz.counter.sellOffline({ ...read.sale, userId: await seller(raw.userId) });
      if (!done.ok) results.push({ key, status: "refused", reason: "Something on this sale isn't on your price list." });
      else {
        results.push({ key, status: done.duplicate ? "duplicate" : "saved" });
        if (!done.duplicate) saved++;
      }
    }
    if (saved) ctx.log.info(`Owner app: ${biz.name} offline till sent ${saved} sale${saved === 1 ? "" : "s"}`);
    return c.json({ results });
  });
}

const MANIFEST = {
  name: "yarnOga till",
  short_name: "yarnOga till",
  description: "Ring up counter sales, with or without internet.",
  start_url: "/home/till",
  scope: "/home/",
  display: "standalone",
  background_color: "#0a0d0b",
  theme_color: "#0a0d0b",
  icons: [
    { src: "/home/brand/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/home/brand/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/home/brand/app-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

/**
 * Keeps the till page, the barcode reader and the fonts on the device. The
 * till page is fetched fresh when there's internet; any other app page that
 * can't load offline shows the till instead.
 */
const SERVICE_WORKER = `const CACHE = "yarnoga-till-1";
const KEEP = ["/home/till", "/home/assets/zxing.js", "/home/manifest.webmanifest", "/home/brand/mark-64.png", "/home/brand/app-192.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(KEEP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
async function fresh(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && !res.redirected) await cache.put(key, res.clone());
    return res;
  } catch (e) {
    const kept = await cache.match(key);
    if (kept) return kept;
    throw e;
  }
}
async function kept(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") await cache.put(req, res.clone());
  return res;
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return e.respondWith(kept(req));
  if (url.origin !== location.origin) return;
  if (url.pathname === "/home/till") return e.respondWith(fresh(req, "/home/till"));
  if (KEEP.includes(url.pathname) || url.pathname.startsWith("/home/brand/")) return e.respondWith(kept(req));
  if (req.mode === "navigate" && url.pathname.startsWith("/home")) {
    e.respondWith(fetch(req).catch(() => caches.open(CACHE).then((c) => c.match("/home/till"))));
  }
});
`;

function tillPage(): string {
  const body = `<div class="content till"><header class="topbar"><a class="topmark" style="display:block" href="/home" aria-label="yarnOga">${mark("mt", 36)}</a><div class="titles"><p class="crumb" id="biz">yarnOga</p><h1>Till</h1></div>
<div class="topactions"><a class="button ghost small" href="/home/counter">Back to the app</a></div></header>
<main style="margin:0 auto">
<p class="flash" id="net" role="status">Opening the till…</p>
<div class="card" id="waiting" hidden style="margin-bottom:16px"><p style="margin:0" id="waiting-text"></p><div class="actions" style="margin-top:12px"><button type="button" class="small" id="send">Send now</button></div></div>
<div id="sell" hidden>
<div style="display:flex;gap:8px"><input type="search" id="find" placeholder="Search or scan a barcode" aria-label="Search products or scan a barcode" autocomplete="off" style="flex:1;min-width:0"><button type="button" class="ghost" id="scan" hidden>${icon("barcode", 18)}Scan</button></div>
<p class="muted small" id="scanned" aria-live="polite" style="margin:6px 0"></p>${scannerBox()}
<div class="sellables" id="list"></div>
<p style="margin:16px 0 6px"><b>Paid by</b></p><div style="display:flex;gap:20px;flex-wrap:wrap" id="paid"></div>
<div class="actions"><button type="button" id="check">Check the total</button><span class="muted small" id="picked"></span></div>
</div>
<div id="confirm" hidden><div class="flash bad" id="problems" hidden></div><div class="card"><div class="scroll"><table id="lines"></table></div><p class="muted" style="margin:12px 0 0" id="paid-note"></p></div>
<div class="actions"><button type="button" id="sell-btn">Confirm sale</button><button type="button" class="ghost" id="change">Change</button></div>
<p class="muted small">Confirming saves the sale on this device first, then sends it when there's internet.</p></div>
<h2>Sales on this till today</h2><div id="today"><p class="muted">No sales on this till yet today.</p></div>
<p class="muted small" style="margin-top:20px">Today's totals, profit and the dashboard need internet. They catch up once the sales here are sent.</p>
<div class="actions"><button type="button" class="ghost" id="install" hidden>Install the till on this device</button></div>
<p class="muted small" id="ios" hidden>To keep the till on this iPhone: tap Share, then Add to Home Screen.</p>
</main></div>
<script>${BARCODE_KEY_JS}</script><script>${TILL_SCRIPT}</script>`;
  return doc("Till", body, `<link rel="manifest" href="/home/manifest.webmanifest">`);
}

/** The till itself: everything runs on the device, from its copy of the price list. */
const TILL_SCRIPT = String.raw`(function () {
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("yarnoga-till:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("yarnoga-till:" + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  var data = store.get("data", null);
  var sales = store.get("sales", []);
  var online = navigator.onLine, loggedOut = false, noRole = false, syncing = false, pending = null;

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    for (var a in attrs || {}) n.setAttribute(a, attrs[a]);
    if (text != null) n.textContent = text;
    return n;
  }
  function money(m) {
    var whole = Math.floor(m / 100), rest = m % 100, pad = rest < 10 ? "0" + rest : String(rest);
    if (!data || (data.currency !== "XOF" && data.currency !== "XAF")) return "₦" + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (rest ? "." + pad : "");
    return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (rest ? "," + pad : "") + " FCFA";
  }
  function today(at) { var d = new Date(at), n = new Date(); return d.toDateString() === n.toDateString(); }
  function save() {
    // Sent sales from earlier days aren't needed on the device any more.
    sales = sales.filter(function (s) { return s.status !== "sent" || today(s.at); });
    return store.set("sales", sales);
  }
  function waiting(biz) { return sales.filter(function (s) { return s.status === "waiting" && (!biz || s.businessId === biz); }); }

  // Stock the till knows about: the last count, less what's sold here and not sent yet.
  function left(item) {
    if (item.stock === null) return null;
    var sold = 0;
    waiting(data.businessId).forEach(function (s) { s.lines.forEach(function (l) { if (l.id === item.id) sold += l.quantity; }); });
    return Math.max(0, item.stock - sold);
  }
  function price(item, qty) {
    if (qty < item.min) return { problem: item.name + ": the smallest sale is " + item.min + "." };
    var best = null;
    item.tiers.forEach(function (t) { if (qty >= t[0] && (!best || t[0] > best[0])) best = t; });
    if (!best) return { problem: item.name + ": no price for " + qty + " on the price list." };
    return { unit: best[1], total: best[1] * qty };
  }

  function showNet() {
    var net = $("net"), mine = data ? waiting(data.businessId).length : 0;
    if (loggedOut) { net.className = "flash bad"; net.innerHTML = ""; net.append("You're logged out. ", el("a", { href: "/home/login" }, "Log in"), " with internet, then open the till again to send the sales saved here."); }
    else if (noRole) { net.className = "flash bad"; net.textContent = "Your role doesn't include counter sales. Ask the owner if you need it."; }
    else if (!data) { net.className = "flash bad"; net.textContent = online ? "Loading the price list…" : "No internet. Open the till once with internet so it can keep a copy of your price list."; }
    else if (!online) { net.className = "flash bad"; net.textContent = "No internet. Keep selling: sales are saved on this device and sent when the internet is back."; }
    else { net.className = "flash good"; net.textContent = mine ? "Online. Sending sales…" : "Online. Every sale is sent."; }
    var box = $("waiting"), others = sales.filter(function (s) { return s.status === "waiting" && data && s.businessId !== data.businessId; });
    var parts = [];
    if (mine) parts.push(mine + (mine === 1 ? " sale is" : " sales are") + " saved on this device, waiting to be sent.");
    if (others.length) parts.push(others.length + " sale" + (others.length === 1 ? "" : "s") + " from " + others[0].businessName + " will be sent when someone from there logs in on this device.");
    box.hidden = !parts.length;
    $("waiting-text").textContent = parts.join(" ");
    $("send").hidden = !mine || !online;
  }

  function drawList() {
    var list = $("list");
    list.innerHTML = "";
    $("biz").textContent = data.businessName;
    $("scan").hidden = !data.barcodes;
    data.items.forEach(function (item) {
      var row = el("div", { class: "sellable", "data-id": item.id, "data-name": item.name.toLowerCase() });
      if (item.barcode) row.dataset.barcode = item.barcode;
      var info = el("div", { style: "min-width:0" });
      info.append(el("b", null, item.name));
      var count = left(item);
      var notes = [item.tiers.map(function (t, i) { return i === 0 ? money(t[1]) + " each" : money(t[1]) + " from " + t[0]; }).join(", ")];
      if (item.min > 1) notes.push("smallest sale " + item.min);
      if (count !== null) notes.push(count ? count + " left" : "none left on the count");
      info.append(el("p", { class: "muted small", style: "margin:0" }, notes.join(" · ")));
      var qty = el("div", { class: "qty" });
      var less = el("button", { type: "button", class: "ghost small", "aria-label": "One less" }, "−");
      var input = el("input", { inputmode: "numeric", "aria-label": "How many " + item.name });
      var more = el("button", { type: "button", class: "small", "aria-label": "One more" }, "+");
      less.onclick = function () { step(input, -1); };
      more.onclick = function () { step(input, 1); };
      input.oninput = count0;
      qty.append(less, input, more);
      row.append(info, qty);
      list.append(row);
    });
    var paid = $("paid");
    paid.innerHTML = "";
    data.paidBy.forEach(function (p, i) {
      var label = el("label", { class: "check", style: "margin:0" });
      var radio = el("input", { type: "radio", name: "paid", value: p[0] });
      if (i === 0) radio.checked = true;
      label.append(radio, " " + p[1]);
      paid.append(label);
    });
    $("sell").hidden = false;
    filter();
    count0();
  }
  function step(input, by) {
    var n = Math.max(0, (parseInt(input.value, 10) || 0) + by);
    input.value = n || "";
    count0();
  }
  function count0() {
    var n = 0;
    document.querySelectorAll("#list .qty input").forEach(function (i) { n += parseInt(i.value, 10) || 0; });
    $("picked").textContent = n ? n + (n === 1 ? " piece picked" : " pieces picked") : "";
  }
  function filter() {
    var q = $("find").value.trim().toLowerCase();
    document.querySelectorAll("#list .sellable").forEach(function (row) { row.hidden = q !== "" && row.dataset.name.indexOf(q) < 0; });
  }
  $("find").addEventListener("input", filter);

  function added(code) {
    var key = barcodeKey(code);
    var row = Array.prototype.find.call(document.querySelectorAll("#list .sellable[data-barcode]"), function (r) { return r.dataset.barcode === key; });
    if (!row) { $("scanned").textContent = "Barcode " + code + " isn't on the price list on this till."; return; }
    var input = row.querySelector("input");
    step(input, 1);
    row.hidden = false;
    $("scanned").textContent = "Added " + row.querySelector("b").textContent + " (" + input.value + ")";
  }
  $("scan").addEventListener("click", function () { window.scanBarcodes(added, true); });
  // A plug-in scanner types the code and presses Enter.
  $("find").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!$("find").value.trim()) return;
    added($("find").value);
    $("find").value = "";
    filter();
  });

  $("check").addEventListener("click", function () {
    var lines = [], problems = [];
    document.querySelectorAll("#list .sellable").forEach(function (row) {
      var text = row.querySelector("input").value.trim().replace(/,/g, "");
      if (!text || text === "0") return;
      var item = data.items.find(function (i) { return i.id === row.dataset.id; });
      var qty = Number(text);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100000) { problems.push('"' + text + '" isn\'t a number of pieces.'); return; }
      var p = price(item, qty);
      if (p.problem) problems.push(p.problem);
      else lines.push({ id: item.id, name: item.name, quantity: qty, unitPriceKobo: p.unit, totalKobo: p.total });
    });
    if (!lines.length && !problems.length) problems.push("Tap + next to what the customer is buying.");
    var box = $("problems");
    box.hidden = !problems.length;
    box.textContent = problems.join(" ");
    if (problems.length) { $("confirm").hidden = false; $("lines").innerHTML = ""; $("paid-note").textContent = ""; $("sell-btn").hidden = true; return; }
    var paidBy = document.querySelector("#paid input:checked").value;
    var total = lines.reduce(function (t, l) { return t + l.totalKobo; }, 0);
    pending = { key: crypto.randomUUID(), businessId: data.businessId, businessName: data.businessName, userId: data.userId, paidBy: paidBy, lines: lines, total: total };
    var table = $("lines");
    table.innerHTML = "";
    var head = el("tr");
    ["Item", "How many", "Price each", "Total"].forEach(function (h) { head.append(el("th", null, h)); });
    table.append(head);
    lines.forEach(function (l) {
      var tr = el("tr");
      [l.name, String(l.quantity), money(l.unitPriceKobo), money(l.totalKobo)].forEach(function (v) { tr.append(el("td", null, v)); });
      table.append(tr);
    });
    var sum = el("tr"), label = el("td", { colspan: "3" }), amount = el("td");
    label.append(el("b", null, "Total to collect"));
    amount.append(el("b", null, money(total)));
    sum.append(label, amount);
    table.append(sum);
    $("paid-note").textContent = "Paid by " + data.paidBy.find(function (p) { return p[0] === paidBy; })[1];
    $("sell-btn").hidden = false;
    $("sell-btn").disabled = false;
    $("sell").hidden = true;
    $("confirm").hidden = false;
  });
  $("change").addEventListener("click", function () { $("confirm").hidden = true; $("sell").hidden = false; });
  $("sell-btn").addEventListener("click", function () {
    if (!pending) return;
    $("sell-btn").disabled = true;
    if (!sales.some(function (s) { return s.key === pending.key; })) {
      pending.at = new Date().toISOString();
      pending.status = "waiting";
      sales.push(pending);
      if (!save()) {
        sales.pop();
        $("sell-btn").disabled = false;
        alert("This sale couldn't be saved on this device (its storage may be full). It has not been recorded.");
        return;
      }
    }
    pending = null;
    $("confirm").hidden = true;
    document.querySelectorAll("#list .qty input").forEach(function (i) { i.value = ""; });
    $("find").value = "";
    $("scanned").textContent = "Sale saved.";
    drawList();
    drawToday();
    showNet();
    sync();
  });

  function drawToday() {
    var mine = sales.filter(function (s) { return data && s.businessId === data.businessId && (today(s.at) || s.status !== "sent"); }).slice().reverse();
    var box = $("today");
    box.innerHTML = "";
    if (!mine.length) { box.append(el("p", { class: "muted" }, "No sales on this till yet today.")); return; }
    var kept = mine.filter(function (s) { return today(s.at); });
    box.append(el("p", null, kept.length + " sale" + (kept.length === 1 ? "" : "s") + " · " + money(kept.reduce(function (t, s) { return t + s.total; }, 0))));
    var wrap = el("div", { class: "scroll" }), table = el("table"), head = el("tr");
    ["Time", "Items", "Paid by", "Total", ""].forEach(function (h) { head.append(el("th", null, h)); });
    table.append(head);
    mine.forEach(function (s) {
      var tr = el("tr");
      tr.append(el("td", null, new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
      tr.append(el("td", null, s.lines.map(function (l) { return l.quantity + " x " + l.name; }).join(", ")));
      var how = data.paidBy.find(function (p) { return p[0] === s.paidBy; });
      tr.append(el("td", null, how ? how[1] : s.paidBy));
      tr.append(el("td", null, money(s.total)));
      var state = el("td");
      if (s.status === "sent") state.append(el("span", { class: "tag lime" }, "sent"));
      else if (s.status === "waiting") state.append(el("span", { class: "tag amber" }, "waiting"));
      else {
        state.append(el("span", { class: "tag red", title: s.reason || "" }, "not sent"), " ", el("span", { class: "muted small" }, s.reason || ""));
        var drop = el("button", { type: "button", class: "ghost small" }, "Remove");
        drop.onclick = function () {
          if (!confirm("Remove this sale from the till? It was never recorded, so it won't be in your figures.")) return;
          sales = sales.filter(function (x) { return x.key !== s.key; });
          save();
          drawToday();
        };
        state.append(" ", drop);
      }
      tr.append(state);
      table.append(tr);
    });
    wrap.append(table);
    box.append(wrap);
  }

  function json(res) {
    // Logged out: the app sends its login page instead.
    if (res.redirected || res.status === 401) { loggedOut = true; return null; }
    if (res.status === 403) { noRole = true; return null; }
    if (!res.ok) throw new Error("status " + res.status);
    loggedOut = false;
    noRole = false;
    return res.json();
  }
  async function sync() {
    if (syncing) return;
    syncing = true;
    try {
      if (data) {
        var batch = waiting(data.businessId).slice(0, 50);
        if (batch.length) {
          var answer = await fetch("/home/till/sync", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ sales: batch.map(function (s) { return { key: s.key, businessId: s.businessId, userId: s.userId, at: s.at, paidBy: s.paidBy, lines: s.lines }; }) })
          }).then(json);
          online = true;
          if (answer) {
            answer.results.forEach(function (r) {
              var s = sales.find(function (x) { return x.key === r.key; });
              if (!s) return;
              if (r.status === "saved" || r.status === "duplicate") s.status = "sent";
              else if (r.status === "refused") { s.status = "refused"; s.reason = r.reason; }
            });
            save();
          }
        }
      }
      var fresh = await fetch("/home/till/data", { credentials: "same-origin", headers: { Accept: "application/json" } }).then(json);
      online = true;
      if (fresh) {
        var picked = {};
        document.querySelectorAll("#list .sellable").forEach(function (row) { var v = row.querySelector("input").value; if (v) picked[row.dataset.id] = v; });
        data = fresh;
        store.set("data", data);
        if ($("confirm").hidden) {
          drawList();
          document.querySelectorAll("#list .sellable").forEach(function (row) { if (picked[row.dataset.id]) row.querySelector("input").value = picked[row.dataset.id]; });
          count0();
        }
        if (waiting(data.businessId).length) setTimeout(sync, 500);
      }
    } catch (e) {
      online = false;
    } finally {
      syncing = false;
      if (data) drawToday();
      showNet();
    }
  }
  $("send").addEventListener("click", sync);
  window.addEventListener("online", sync);
  window.addEventListener("offline", function () { online = false; showNet(); });
  setInterval(sync, 30000);

  if (data) { drawList(); drawToday(); }
  showNet();
  sync();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/home/sw.js", { scope: "/home/" }).catch(function () {});
  var install = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); install = e; $("install").hidden = false; });
  $("install").addEventListener("click", function () { if (install) install.prompt(); install = null; $("install").hidden = true; });
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (/iphone|ipad/i.test(navigator.userAgent) && !standalone) $("ios").hidden = false;
})();`;

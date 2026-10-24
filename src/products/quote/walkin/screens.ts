import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Hono } from "hono";
import { formatNaira } from "../../../core/money.js";
import type { Notice } from "../../../core/product.js";
import { showWaId } from "../../../core/whatsapp/ids.js";
import { COUNTER } from "./index.js";
import { ALL_STATIONS, readPickupToken, readScreenToken } from "./links.js";
import type { PickupOrder, Ticket, WalkInStore } from "./store.js";

// The pages for walk-in orders (QUOTE_WALK_IN), each behind a signed link:
//
//   /screen/<token>  a pickup screen for one station (Bar, Kitchen) or all of
//                    them, on a phone or tablet at that spot. Paid orders come
//                    in as tickets: Making > Ready > Collected. Ready messages
//                    the customer. Staff scan the receipt's QR code with the
//                    screen's camera, or type the order number and 4-digit
//                    code, to hand an order over. A ticket can only be handed
//                    over once; a second scan shows when it was collected.
//                    Unpaid walk-in orders wait in their own list with a
//                    "Paid at counter" button.
//   /pickup/<token>  what a customer sees if they scan their own QR code:
//                    where their order is up to.

export interface ScreenBusiness {
  name: string;
  orderPrefix: string;
  store: WalkInStore;
  /** The WhatsApp number the business answers on; null for the main number. */
  fromNumberId: string | null;
  /** Marks an order paid at the counter: receipt to the customer, tickets to the screens. Returns the messages to send. */
  paidAtCounter(orderNumber: number): Promise<Notice[]>;
}

export interface ScreenDeps {
  secret: string;
  business(id: string): Promise<ScreenBusiness | null>;
  /** Sends notices from the business's number. A failed send is logged, not thrown. */
  send(notices: Notice[], fromNumberId: string | null): Promise<void>;
  now?: () => Date;
}

/** Tickets older than this drop off the screen (a long night, or yesterday's lunch). */
const SCREEN_HOURS = 16;
/** Collected tickets stay on the screen this long, so staff can see what just went out. */
const COLLECTED_SHOWN_MS = 20 * 60_000;
const UUID = /^[0-9a-f-]{36}$/;

let jsQr: string | undefined;
function jsQrSource(): string {
  jsQr ??= readFileSync(createRequire(import.meta.url).resolve("jsqr/dist/jsQR.js"), "utf8");
  return jsQr;
}

export function createWalkInScreens(deps: ScreenDeps) {
  const app = new Hono();
  const now = () => (deps.now ? deps.now() : new Date());

  async function load(token: string) {
    const screen = readScreenToken(deps.secret, token);
    const business = screen ? await deps.business(screen.businessId) : null;
    if (!screen || !business) return null;
    return { ...business, businessId: screen.businessId, station: screen.station, token };
  }
  type Screen = NonNullable<Awaited<ReturnType<typeof load>>>;
  const stationFilter = (s: Screen) => (s.station === ALL_STATIONS ? undefined : s.station);
  const back = (s: Screen, note?: string) => `/screen/${s.token}${note ? `?note=${encodeURIComponent(note)}` : ""}`;

  async function listHtml(s: Screen): Promise<string> {
    const at = now();
    const since = new Date(at.getTime() - SCREEN_HOURS * 3_600_000);
    const [tickets, unpaid] = await Promise.all([
      s.store.tickets(since, new Date(at.getTime() - COLLECTED_SHOWN_MS), stationFilter(s)),
      s.store.unpaid(since),
    ]);
    const making = tickets.filter((t) => t.status === "making");
    const ready = tickets.filter((t) => t.status === "ready");
    const collected = tickets.filter((t) => t.status === "collected").reverse();
    const ref = (n: number) => `${s.orderPrefix}-${n}`;
    const button = (path: string, field: string, value: string, label: string, kind = "") =>
      `<form method="post" action="/screen/${esc(s.token)}/${path}"><input type="hidden" name="${field}" value="${esc(value)}"><button class="${kind}">${label}</button></form>`;
    const card = (t: Ticket, actions: string) =>
      `<li class="card"><p class="ref">${ref(t.orderNumber)}${t.tableLabel ? ` <span class="table">${esc(t.tableLabel)}</span>` : ""}${s.station === ALL_STATIONS ? ` <span class="muted">${esc(t.station)}</span>` : ""}</p>
<p>${esc(t.items)}</p><p class="muted">${esc(t.customerName ?? showWaId(t.customerWaId))} · ${clock(t.createdAt)}</p>${actions}</li>`;
    const column = (title: string, list: Ticket[], actions: (t: Ticket) => string) =>
      `<div class="column"><h2>${title} <span class="count">${list.length}</span></h2><ul>${list.map((t) => card(t, actions(t))).join("") || `<li class="empty">Nothing here</li>`}</ul></div>`;
    const unpaidList = unpaid.length
      ? `<div class="unpaid"><h2>Waiting for payment <span class="count">${unpaid.length}</span></h2><ul>${unpaid
          .map(
            (o) =>
              `<li class="card"><p class="ref">${ref(o.orderNumber)} · ${formatNaira(o.totalKobo)}${o.tableLabel ? ` <span class="table">${esc(o.tableLabel)}</span>` : ""}</p><p>${esc(o.items)}</p>${button("paid", "order", String(o.orderNumber), "Paid at counter", "quiet")}</li>`,
          )
          .join("")}</ul></div>`
      : "";
    return `<div class="board">${column("Making", making, (t) => button("ready", "ticket", t.id, "Ready"))}${column("Ready", ready, (t) => button("collect", "ticket", t.id, "Collected"))}${column(
      "Collected",
      collected,
      (t) => `<p class="muted">Handed over at ${clock(t.collectedAt!)}</p>`,
    )}</div>${unpaidList}`;
  }

  app.get("/screen/assets/jsQR.js", (c) => {
    c.header("Cache-Control", "public, max-age=604800");
    return c.body(jsQrSource(), 200, { "Content-Type": "text/javascript; charset=utf-8" });
  });

  app.get("/screen/:token", async (c) => {
    const s = await load(c.req.param("token"));
    if (!s) return c.html(page("Screen not found", `<p>This link isn't right. The owner can send <b>screens</b> to the bot on WhatsApp for the links.</p>`), 404);
    const note = c.req.query("note");
    const title = s.station === ALL_STATIONS ? "All orders" : s.station === COUNTER ? "Counter" : s.station;
    return c.html(
      page(
        `${s.name} · ${title}`,
        `${note ? `<p class="note">${esc(note)}</p>` : ""}
<form class="find" method="post" action="/screen/${esc(s.token)}/find" id="find">
<input name="code" id="code" placeholder="Order number and code, e.g. 214 4827" autocomplete="off" inputmode="numeric">
<button>Find</button><button type="button" id="scan" class="quiet">Scan QR</button></form>
<div id="camera" hidden><video id="video" playsinline muted></video><button type="button" id="stop" class="quiet">Stop scanning</button></div>
<div id="list">${await listHtml(s)}</div>`,
        screenScript(s.token),
      ),
    );
  });

  app.get("/screen/:token/list", async (c) => {
    const s = await load(c.req.param("token"));
    if (!s) return c.text("Not found", 404);
    return c.html(await listHtml(s));
  });

  app.post("/screen/:token/ready", async (c) => {
    const s = await load(c.req.param("token"));
    if (!s) return c.text("Not found", 404);
    const id = String((await c.req.parseBody()).ticket ?? "");
    const ticket = UUID.test(id) ? await s.store.moveTicket(id, ["making"], "ready") : null;
    if (ticket) {
      const ref = `${s.orderPrefix}-${ticket.orderNumber}`;
      const where = ticket.station === COUNTER ? "the counter" : `the ${ticket.station}`;
      await deps.send(
        [
          {
            to: ticket.customerWaId,
            text: ticket.tableLabel
              ? `Your order ${ref} is ready (${ticket.items}). We're bringing it to ${ticket.tableLabel}.`
              : `Your order ${ref} is ready at ${where} (${ticket.items}). Show the QR code on your receipt to collect it.`,
          },
        ],
        s.fromNumberId,
      );
    }
    return c.redirect(back(s), 303);
  });

  app.post("/screen/:token/collect", async (c) => {
    const s = await load(c.req.param("token"));
    if (!s) return c.text("Not found", 404);
    const form = await c.req.parseBody();
    const id = String(form.ticket ?? "");
    const ticket = UUID.test(id) ? await s.store.moveTicket(id, ["making", "ready"], "collected") : null;
    const order = typeof form.order === "string" && UUID.test(form.order) ? form.order : null;
    if (order) return c.redirect(`/screen/${s.token}/order/${order}${ticket ? "" : "?note=already"}`, 303);
    return c.redirect(back(s, ticket ? undefined : "That ticket was already handed over."), 303);
  });

  app.post("/screen/:token/paid", async (c) => {
    const s = await load(c.req.param("token"));
    if (!s) return c.text("Not found", 404);
    const number = Number((await c.req.parseBody()).order);
    if (!Number.isInteger(number) || number <= 0) return c.redirect(back(s), 303);
    const notices = await s.paidAtCounter(number);
    await deps.send(notices, s.fromNumberId);
    return c.redirect(back(s, `${s.orderPrefix}-${number} marked paid. The customer has their receipt.`), 303);
  });

  // A scanned QR code (the receipt's pickup link) or a typed "214 4827".
  app.post("/screen/:token/find", async (c) => {
    const s = await load(c.req.param("token"));
    if (!s) return c.text("Not found", 404);
    const code = String((await c.req.parseBody()).code ?? "").trim();
    const link = code.match(/\/pickup\/([^/?#\s]+)/);
    let order: PickupOrder | null = null;
    if (link) {
      const found = readPickupToken(deps.secret, link[1]!);
      order = found?.businessId === s.businessId ? await s.store.order(found.orderId) : null;
    } else {
      const typed = code.match(/^(?:[a-z]+\s*-?\s*)?(\d{1,9})\D+(\d{4})$/i);
      order = typed ? await s.store.findByCode(Number(typed[1]), typed[2]!) : null;
    }
    if (!order) return c.redirect(back(s, link ? "That QR code isn't one of this business's orders." : "No order matches that number and code."), 303);
    return c.redirect(`/screen/${s.token}/order/${order.id}`, 303);
  });

  app.get("/screen/:token/order/:order", async (c) => {
    const s = await load(c.req.param("token"));
    const orderId = c.req.param("order");
    if (!s || !UUID.test(orderId)) return c.text("Not found", 404);
    const order = await s.store.order(orderId);
    if (!order) return c.redirect(back(s, "That order can't be found."), 303);
    const ref = `${s.orderPrefix}-${order.orderNumber}`;
    const all = await s.store.ticketsForOrder(order.id);
    const mine = s.station === ALL_STATIONS ? all : all.filter((t) => t.station === s.station);
    const head = `<p>${order.tableLabel ? `<span class="table">${esc(order.tableLabel)}</span> ` : ""}${esc(order.customerName ?? showWaId(order.customerWaId))} · ${formatNaira(order.totalKobo)}</p>`;
    let body: string;
    if (order.status !== "paid") {
      body = `<p class="stop">Not paid yet. Don't hand it over.</p>${
        order.status === "confirmed"
          ? `<form method="post" action="/screen/${esc(s.token)}/paid"><input type="hidden" name="order" value="${order.orderNumber}"><button>Paid at counter</button></form>`
          : ""
      }`;
    } else if (!mine.length) {
      const elsewhere = [...new Set(all.map((t) => t.station))];
      body = `<p class="stop">Nothing in this order is collected here.${elsewhere.length ? ` Send them to: ${esc(elsewhere.join(", "))}.` : ""}</p>`;
    } else {
      body = mine
        .map((t) =>
          t.status === "collected"
            ? `<div class="ticket"><p><b>${esc(t.station)}</b>: ${esc(t.items)}</p><p class="stop">Already collected at ${clock(t.collectedAt!)}. Don't hand it over again.</p></div>`
            : `<div class="ticket"><p><b>${esc(t.station)}</b>: ${esc(t.items)}</p>${t.status === "making" ? `<p class="muted">Still being made.</p>` : ""}
<form method="post" action="/screen/${esc(s.token)}/collect"><input type="hidden" name="ticket" value="${t.id}"><input type="hidden" name="order" value="${order.id}"><button>Hand over</button></form></div>`,
        )
        .join("");
      const others = all.filter((t) => !mine.includes(t) && t.status !== "collected").map((t) => t.station);
      if (others.length) body += `<p class="muted">The rest is collected at: ${esc([...new Set(others)].join(", "))}.</p>`;
    }
    const again = c.req.query("note") === "already" ? `<p class="stop">That was already handed over.</p>` : "";
    return c.html(page(`${s.name} · ${ref}`, `${again}${head}${body}<p><a href="${back(s)}">Back to the screen</a></p>`));
  });

  app.get("/pickup/:token", async (c) => {
    const found = readPickupToken(deps.secret, c.req.param("token"));
    const business = found ? await deps.business(found.businessId) : null;
    const order = found && business ? await business.store.order(found.orderId) : null;
    if (!business || !order) return c.html(page("Order not found", `<p>This code isn't right. Please ask a member of staff.</p>`), 404);
    const tickets = await business.store.ticketsForOrder(order.id);
    const state = (t: Ticket) => (t.status === "collected" ? `collected at ${clock(t.collectedAt!)}` : t.status === "ready" ? "ready to collect" : "being made");
    const lines =
      order.status !== "paid"
        ? `<p>Waiting for payment.</p>`
        : tickets.map((t) => `<p><b>${esc(t.station)}</b>: ${state(t)}</p>`).join("") || `<p>Paid. It'll show here once it's on its way.</p>`;
    return c.html(
      page(
        `${business.name} · ${business.orderPrefix}-${order.orderNumber}`,
        `${lines}<p class="muted">Show the QR code on your receipt to staff when you collect.</p>`,
      ),
    );
  });

  return app;
}

function clock(at: Date): string {
  return at.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" });
}

function screenScript(token: string): string {
  return `<script src="/screen/assets/jsQR.js" defer></script><script>
(() => {
  const list = document.getElementById("list");
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/screen/${token}/list", { cache: "no-store" });
      if (res.ok) list.innerHTML = await res.text();
    } catch {}
  }, 8000);

  const form = document.getElementById("find"), code = document.getElementById("code");
  const camera = document.getElementById("camera"), video = document.getElementById("video");
  let stream = null;
  const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; camera.hidden = true; };
  const found = (text) => { stop(); code.value = text; form.submit(); };
  document.getElementById("stop").onclick = stop;
  document.getElementById("scan").onclick = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch {
      alert("The camera didn't open. Allow camera use for this page, or type the order number and code.");
      return;
    }
    camera.hidden = false;
    video.srcObject = stream;
    await video.play();
    const detector = "BarcodeDetector" in window ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const look = async () => {
      if (!stream) return;
      if (video.readyState >= 2) {
        if (detector) {
          const codes = await detector.detect(video).catch(() => []);
          if (codes[0]) return found(codes[0].rawValue);
        } else if (window.jsQR) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
          if (hit) return found(hit.data);
        }
      }
      requestAnimationFrame(look);
    };
    look();
  };
})();
</script>`;
}

function page(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>
body{margin:0;font:17px/1.45 system-ui,sans-serif;background:#0c0d0d;color:#f3f4ef}
main{max-width:1200px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:1.4rem;margin:.2em 0 .6em}h2{font-size:1.1rem;margin:0 0 10px}
p{margin:0 0 4px}.muted{color:#9a9d97;font-size:.9rem}a{color:#c6ff1f}
.find{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.find input{flex:1;min-width:12em;font:inherit;padding:10px;border-radius:8px;border:1px solid #2e302f;background:#151616;color:inherit}
#camera{margin-bottom:16px}video{width:100%;max-width:480px;border-radius:10px;display:block;margin-bottom:8px}
.board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (max-width:800px){.board{grid-template-columns:1fr}}
.column,.unpaid{background:#151616;border:1px solid #2e302f;border-radius:10px;padding:12px}.unpaid{margin-top:12px}
.count{color:#9a9d97;font-weight:400}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.card,.ticket{background:#1d1e1e;border-radius:8px;padding:12px}.ticket{margin-bottom:10px}.empty{color:#9a9d97;font-size:.9rem}
.ref{font-weight:700;font-size:1.1rem}.table{background:#c6ff1f;color:#0c0d0d;border-radius:4px;padding:1px 6px;font-size:.85rem}
form{margin:8px 0 0}
button{background:#c6ff1f;color:#0c0d0d;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:700;cursor:pointer}
button.quiet{background:#2e302f;color:#f3f4ef}
.note{background:#1d1e1e;border-left:4px solid #c6ff1f;padding:10px;margin-bottom:12px}
.stop{background:#3a1512;color:#ffb4a8;border-radius:8px;padding:12px;font-weight:700;margin:8px 0}
</style></head><body><main><h1>${esc(title)}</h1>
${body}</main>${script}</body></html>`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

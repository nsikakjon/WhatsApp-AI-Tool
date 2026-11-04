import { Hono } from "hono";
import { showWaId } from "../../../core/whatsapp/ids.js";
import { clock, esc, jsQrSource, page, scannerScript } from "../walkin/screens.js";
import { readDoorToken, readTicketToken } from "./links.js";
import type { EventTicket, TicketStore } from "./store.js";

// The pages for event tickets (QUOTE_EVENT_TICKETS), each behind a signed link:
//
//   /door/<token>    the door screen, on a phone at the entrance. Staff scan
//                    a ticket's QR code (or type "214 4827") and it's let in
//                    straight away. A ticket gets in once: a second scan shows
//                    a red "already used" with the time. The counts show how
//                    many of each ticket are in.
//   /ticket/<token>  what a ticket's QR code opens on an ordinary phone
//                    camera: whether the ticket is still valid.

export interface DoorBusiness {
  name: string;
  orderPrefix: string;
  store: TicketStore;
}

export interface DoorDeps {
  secret: string;
  business(id: string): Promise<DoorBusiness | null>;
  now?: () => Date;
}

/** The door counts cover tickets sold in this many days. */
const COUNT_DAYS = 60;
const UUID = /^[0-9a-f-]{36}$/;
const JSQR = "/door/assets/jsQR.js";

export function createDoorScreens(deps: DoorDeps) {
  const app = new Hono();
  const now = () => (deps.now ? deps.now() : new Date());

  async function load(token: string) {
    const businessId = readDoorToken(deps.secret, token);
    const business = businessId ? await deps.business(businessId) : null;
    return business && businessId ? { ...business, businessId, token } : null;
  }
  type Door = NonNullable<Awaited<ReturnType<typeof load>>>;
  const ref = (d: Door, t: EventTicket) => `${d.orderPrefix}-${t.orderNumber}`;
  const notFound = () => page("Door screen not found", `<p>This link isn't right. The owner can send <b>door</b> to the bot on WhatsApp for the link.</p>`);

  function scanForm(d: Door): string {
    return `<form class="find" method="post" action="/door/${esc(d.token)}/check" id="find">
<input name="code" id="code" placeholder="Order number and code, e.g. 214 4827" autocomplete="off" inputmode="numeric">
<button type="button" id="scan">Scan QR</button><button class="quiet">Check</button></form>
<div id="camera" hidden><video id="video" playsinline muted></video><button type="button" id="stop" class="quiet">Stop scanning</button></div>`;
  }

  app.get(JSQR, (c) => {
    c.header("Cache-Control", "public, max-age=604800");
    return c.body(jsQrSource(), 200, { "Content-Type": "text/javascript; charset=utf-8" });
  });

  app.get("/door/:token", async (c) => {
    const d = await load(c.req.param("token"));
    if (!d) return c.html(notFound(), 404);
    const counts = await d.store.counts(new Date(now().getTime() - COUNT_DAYS * 86_400_000));
    const note = c.req.query("note");
    const list = counts.length
      ? `<ul>${counts.map((n) => `<li class="card"><p><b>${esc(n.name)}</b></p><p class="muted">${n.checkedIn} in of ${n.sold} sold</p></li>`).join("")}</ul>`
      : `<p class="muted">No tickets sold yet.</p>`;
    return c.html(
      page(`${d.name} · Door`, `${note ? `<p class="stop">${esc(note)}</p>` : ""}${scanForm(d)}<h2>Tickets</h2>${list}`, scannerScript(JSQR, c.req.query("scan") === "1")),
    );
  });

  // A scanned QR code (the ticket's link) or a typed "214 4827": lets the ticket in if it hasn't been.
  app.post("/door/:token/check", async (c) => {
    const d = await load(c.req.param("token"));
    if (!d) return c.text("Not found", 404);
    const code = String((await c.req.parseBody()).code ?? "").trim();
    const link = code.match(/\/ticket\/([^/?#\s]+)/);
    let ticket: EventTicket | null = null;
    if (link) {
      const found = readTicketToken(deps.secret, link[1]!);
      ticket = found?.businessId === d.businessId ? await d.store.ticket(found.ticketId) : null;
    } else {
      const typed = code.match(/^(?:[a-z]+\s*-?\s*)?(\d{1,9})\D+(\d{4})$/i);
      ticket = typed ? await d.store.findByCode(Number(typed[1]), typed[2]!) : null;
    }
    if (!ticket) {
      const why = link ? "Not a ticket for this event. Don't let them in." : "No ticket matches that number and code.";
      return c.redirect(`/door/${d.token}?note=${encodeURIComponent(why)}`, 303);
    }
    const admitted = await d.store.checkIn(ticket.id);
    return c.redirect(`/door/${d.token}/ticket/${ticket.id}${admitted ? "?in=1" : ""}`, 303);
  });

  app.get("/door/:token/ticket/:id", async (c) => {
    const d = await load(c.req.param("token"));
    const id = c.req.param("id");
    if (!d || !UUID.test(id)) return c.text("Not found", 404);
    const ticket = await d.store.ticket(id);
    if (!ticket) return c.redirect(`/door/${d.token}`, 303);
    const who = esc(ticket.holderName ?? showWaId(ticket.holderWaId));
    const body =
      c.req.query("in") === "1"
        ? `<p class="go">Let them in</p><p><b>${esc(ticket.name)}</b></p><p class="muted">${ref(d, ticket)} · ticket ${ticket.seat} · bought by ${who}</p>`
        : `<p class="stop">Already used at ${clock(ticket.checkedInAt!)}. Don't let them in again.</p><p><b>${esc(ticket.name)}</b></p><p class="muted">${ref(d, ticket)} · ticket ${ticket.seat} · bought by ${who}</p>`;
    return c.html(page(`${d.name} · Door`, `${body}<p><a class="next" href="/door/${esc(d.token)}?scan=1">Scan next</a></p>`, DOOR_STYLE));
  });

  app.get("/ticket/:token", async (c) => {
    const found = readTicketToken(deps.secret, c.req.param("token"));
    const business = found ? await deps.business(found.businessId) : null;
    const ticket = found && business ? await business.store.ticket(found.ticketId) : null;
    if (!business || !ticket) return c.html(page("Ticket not found", `<p>This ticket isn't right. Please ask the organisers.</p>`), 404);
    const state = ticket.checkedInAt ? `<p class="stop">Used at ${clock(ticket.checkedInAt)}.</p>` : `<p class="go">Valid for one entry</p>`;
    return c.html(
      page(
        `${business.name} · ${ticket.name}`,
        `${state}<p class="muted">${business.orderPrefix}-${ticket.orderNumber} · ticket ${ticket.seat}</p><p class="muted">Show this QR code at the door. Door staff scan it on the door screen.</p>`,
        DOOR_STYLE,
      ),
    );
  });

  return app;
}

const DOOR_STYLE = `<style>.go{background:#c6ff1f;color:#0c0d0d;border-radius:8px;padding:18px 12px;font-weight:800;font-size:1.6rem;margin:8px 0}
.stop{font-size:1.1rem}a.next{display:inline-block;margin-top:16px;background:#c6ff1f;color:#0c0d0d;border-radius:8px;padding:12px 18px;font-weight:700;text-decoration:none}</style>`;

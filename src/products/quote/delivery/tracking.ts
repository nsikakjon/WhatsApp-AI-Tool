import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { html } from "hono/html";
import type { Notice } from "../../../core/product.js";
import type { TrackingLinks } from "./index.js";
import type { Lang } from "../../../core/i18n.js";
import { riderStep, type RiderStep, type TemplateName } from "./status.js";
import type { Delivery, DeliveryStore } from "./store.js";
import { mapLink } from "./zones.js";
import { courierStep, isValidShipbubbleSignature } from "./shipbubble.js";

// Two pages per delivery, each behind its own signed link:
//   /ride/<token>   the rider's page. While it is open it sends the phone's
//                   location every 15 seconds, and has the Picked up /
//                   Delivered / Couldn't deliver buttons.
//   /track/<token>  the customer's page: where the rider is on a map.
// Phones stop sharing location when the screen locks or the rider switches
// apps, so the rider page asks to keep the screen on and says so.

export interface TrackingDeps {
  /** Signs the links, so nobody can guess another order's page. */
  secret: string;
  /** Our server's public address, e.g. https://example.up.railway.app */
  publicUrl: string;
  store: DeliveryStore;
  /** Sends notices from the number the business uses. A failed send is logged, not thrown. */
  send(notices: Notice[], fromNumberId: string | null): Promise<void>;
  template?: TemplateName;
  /** The language of the business a delivery belongs to (English when unset). */
  language?(d: Delivery): Promise<Lang>;
  /** The Shipbubble API key, which signs its webhooks. Unset: the Shipbubble webhook is off. */
  shipbubbleKey?: string;
  now?: () => Date;
}

type Kind = "track" | "ride";

function signature(secret: string, kind: Kind, id: string): string {
  return createHmac("sha256", secret).update(`${kind}:${id}`).digest("base64url").slice(0, 24);
}

export function createTrackingLinks(secret: string, publicUrl: string): TrackingLinks {
  const base = publicUrl.replace(/\/+$/, "");
  const link = (kind: Kind, d: Pick<Delivery, "id">) => `${base}/${kind}/${d.id}.${signature(secret, kind, d.id)}`;
  return { customer: (d) => link("track", d), rider: (d) => link("ride", d) };
}

/** The delivery id in a valid token, or null. */
function readToken(secret: string, kind: Kind, token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = Buffer.from(signature(secret, kind, id));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

const ON_THE_ROAD = ["assigned", "picked_up"];
// A position older than this is too stale to show the customer.
const STALE_MS = 30 * 60_000;
const MIN_PING_MS = 10_000;
const STEPS: Record<string, RiderStep> = { picked_up: "picked_up", delivered: "delivered", failed: "failed" };

export function createTracking(deps: TrackingDeps) {
  const app = new Hono();
  const links = createTrackingLinks(deps.secret, deps.publicUrl);
  const now = () => (deps.now ? deps.now() : new Date());

  async function load(kind: Kind, token: string): Promise<Delivery | null> {
    const id = readToken(deps.secret, kind, token);
    return id ? deps.store.get(id) : null;
  }

  // Shipbubble tells us a courier picked up or delivered a parcel. The
  // signature is checked before anything else, and riderStep only moves a
  // delivery forward once, so a repeated webhook tells nobody twice.
  app.post("/webhooks/shipbubble", async (c) => {
    const rawBody = await c.req.text();
    if (!deps.shipbubbleKey || !isValidShipbubbleSignature(rawBody, c.req.header("x-ship-signature"), deps.shipbubbleKey)) {
      return c.text("Invalid signature", 401);
    }
    let body: { event?: string; order_id?: string; status?: string };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.text("Invalid JSON", 400);
    }
    const step = body.event === "shipment.cancelled" ? "failed" : courierStep(String(body.status ?? ""));
    if (!body.order_id || !step || !deps.store.byCourierOrder) return c.text("OK", 200);
    try {
      const d = await deps.store.byCourierOrder(body.order_id);
      if (!d) return c.text("OK", 200);
      const moved = await riderStep(deps.store, d, step, {
        trackingLink: d.courier?.trackingUrl ?? links.customer(d),
        template: deps.template,
        lang: await deps.language?.(d),
      });
      if (moved) await deps.send(moved.notices, moved.delivery.fromNumberId);
      return c.text("OK", 200);
    } catch (err) {
      // Not a 200, so Shipbubble tries again.
      console.error(`Shipbubble webhook for ${body.order_id} failed:`, err);
      return c.text("Try again", 500);
    }
  });

  app.get("/track/:token", async (c) => {
    const d = await load("track", c.req.param("token"));
    if (!d) return c.html(notFound(), 404);
    return c.html(customerPage(d));
  });

  app.get("/track/:token/now", async (c) => {
    const d = await load("track", c.req.param("token"));
    if (!d) return c.json({ error: "not found" }, 404);
    const fresh = d.riderSeenAt && now().getTime() - d.riderSeenAt.getTime() < STALE_MS;
    return c.json({
      status: d.status,
      rider:
        ON_THE_ROAD.includes(d.status) && fresh && d.riderLat !== null && d.riderLng !== null
          ? { name: d.riderName, lat: d.riderLat, lng: d.riderLng, seenAt: d.riderSeenAt!.toISOString() }
          : null,
      drop: d.lat !== null && d.lng !== null ? { lat: d.lat, lng: d.lng } : null,
    });
  });

  app.get("/ride/:token", async (c) => {
    const d = await load("ride", c.req.param("token"));
    if (!d) return c.html(notFound(), 404);
    return c.html(riderPage(d));
  });

  app.post("/ride/:token/where", async (c) => {
    const d = await load("ride", c.req.param("token"));
    if (!d) return c.json({ error: "not found" }, 404);
    if (!ON_THE_ROAD.includes(d.status)) return c.json({ status: d.status, sharing: false });
    const body = (await c.req.json().catch(() => ({}))) as { lat?: unknown; lng?: unknown };
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return c.json({ error: "bad position" }, 400);
    }
    const at = now();
    if (!d.riderSeenAt || at.getTime() - d.riderSeenAt.getTime() >= MIN_PING_MS) {
      await deps.store.setRiderPosition(d.id, lat, lng, at);
    }
    return c.json({ status: d.status, sharing: true });
  });

  app.post("/ride/:token/step", async (c) => {
    const d = await load("ride", c.req.param("token"));
    if (!d) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { step?: string };
    const step = STEPS[body.step ?? ""];
    if (!step) return c.json({ error: "unknown step" }, 400);
    const moved = await riderStep(deps.store, d, step, { trackingLink: links.customer(d), template: deps.template, lang: await deps.language?.(d) });
    if (!moved) return c.json({ status: d.status, changed: false });
    await deps.send(moved.notices, moved.delivery.fromNumberId);
    return c.json({ status: moved.delivery.status, changed: true });
  });

  return app;
}

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

function page(title: string, body: unknown, opts: { map?: boolean } = {}) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
${opts.map
  ? html`<link rel="stylesheet" href="${LEAFLET_CSS}" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<script src="${LEAFLET_JS}" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>`
  : ""}
<style>
  :root { --green: #128c4a; --bg: #f4f6f5; --card: #fff; --text: #1b1f1d; --muted: #6b7570; --line: #e1e6e3; --red: #b42318; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); }
  header { background: var(--green); color: #fff; padding: 14px 16px; }
  header h1 { font-size: 18px; margin: 0; }
  header p { margin: 2px 0 0; opacity: .85; font-size: 14px; }
  main { max-width: 560px; margin: 0 auto; padding: 16px; display: grid; gap: 12px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .muted { color: var(--muted); font-size: 14px; }
  #map { height: 320px; border-radius: 12px; border: 1px solid var(--line); }
  ol.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  ol.steps li { display: flex; gap: 10px; align-items: center; color: var(--muted); }
  ol.steps li::before { content: ""; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line); flex: none; }
  ol.steps li.done { color: var(--text); }
  ol.steps li.done::before { background: var(--green); border-color: var(--green); }
  button { font: inherit; font-weight: 600; width: 100%; padding: 14px; border-radius: 10px; border: 0; cursor: pointer; }
  button.primary { background: var(--green); color: #fff; }
  button.plain { background: var(--card); color: var(--text); border: 1px solid var(--line); }
  button.warn { background: var(--card); color: var(--red); border: 1px solid var(--line); }
  button:disabled { opacity: .5; cursor: default; }
  .buttons { display: grid; gap: 8px; }
  a { color: var(--green); }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function notFound() {
  return page("Link not found", html`<main><div class="card">This tracking link isn't valid. Please check you opened the whole link from WhatsApp.</div></main>`);
}

function customerPage(d: Delivery) {
  return page(
    `${d.orderRef} delivery`,
    html`<header><h1>${d.businessName}</h1><p>Order ${d.orderRef}</p></header>
<main>
  <div class="card">
    <ol class="steps" id="steps">
      <li data-step="assigned">Rider assigned</li>
      <li data-step="picked_up">On the way</li>
      <li data-step="delivered">Delivered</li>
    </ol>
    <p class="muted" id="note"></p>
  </div>
  <div id="map"></div>
  <p class="muted">The map shows where ${d.riderName ?? "the rider"} last was while their rider page was open. It updates every 15 seconds.</p>
</main>
<script>
(() => {
  const ORDER = ["assigned", "picked_up", "delivered"];
  const note = document.getElementById("note");
  // If the map library doesn't load, the steps and the note still work.
  const map = window.L ? L.map("map", { zoomControl: false }).setView([6.5244, 3.3792], 11) : null;
  if (map) L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
  else document.getElementById("map").hidden = true;
  let rider, drop, framed = false;
  async function refresh() {
    try {
      const res = await fetch(location.pathname + "/now", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const reached = ORDER.indexOf(data.status);
      document.querySelectorAll("#steps li").forEach((li, i) => li.classList.toggle("done", reached >= i));
      if (map && data.drop && !drop) drop = L.circleMarker([data.drop.lat, data.drop.lng], { radius: 8, color: "#1b1f1d" }).addTo(map).bindTooltip("Delivery point");
      if (data.rider) {
        const at = [data.rider.lat, data.rider.lng];
        if (rider) rider.setLatLng(at); else if (map) rider = L.circleMarker(at, { radius: 10, color: "#128c4a", fillOpacity: 0.9 }).addTo(map);
        const mins = Math.round((Date.now() - Date.parse(data.rider.seenAt)) / 60000);
        note.textContent = (data.rider.name || "The rider") + " was here " + (mins < 1 ? "just now" : mins + " min ago") + ".";
        if (map && !framed) { map.fitBounds(L.latLngBounds([at, ...(drop ? [drop.getLatLng()] : [])]).pad(0.3), { maxZoom: 15 }); framed = true; }
      } else {
        note.textContent = data.status === "delivered" ? "Your order has been delivered." :
          data.status === "failed" || data.status === "cancelled" ? "This delivery has stopped. The business will contact you." :
          "The rider's location will show here once they start sharing it.";
        if (drop && !framed) { map.setView(drop.getLatLng(), 14); framed = true; }
      }
      if (["delivered", "failed", "cancelled"].includes(data.status)) clearInterval(timer);
    } catch {}
  }
  const timer = setInterval(refresh, 15000);
  refresh();
})();
</script>`,
    { map: true },
  );
}

function riderPage(d: Delivery) {
  return page(
    `${d.orderRef} job`,
    html`<header><h1>${d.orderRef} for ${d.businessName}</h1><p>${d.riderName ?? "Rider"}</p></header>
<main>
  <div class="card">
    <div><strong>Deliver to:</strong> ${d.address ?? "the pinned location"}</div>
    <div><a href="${mapLink(d)}">Open in Google Maps</a></div>
    <div><strong>Customer:</strong> ${d.customerName ?? ""} <a href="tel:+${d.customerWaId}">+${d.customerWaId}</a></div>
  </div>
  <div class="card">
    <button class="primary" id="share">Start sharing my location</button>
    <p class="muted" id="sharing">Keep this page open on your screen while you ride. If you lock the phone or switch apps, the customer stops seeing you move.</p>
  </div>
  <div class="buttons">
    <button class="plain" data-step="picked_up">Picked up</button>
    <button class="plain" data-step="delivered">Delivered</button>
    <button class="warn" data-step="failed">Couldn't deliver</button>
  </div>
  <p class="muted" id="status">Status: ${words(d.status)}</p>
</main>
<script>
(() => {
  const base = location.pathname;
  const sharing = document.getElementById("sharing");
  const status = document.getElementById("status");
  const shareButton = document.getElementById("share");
  let watch = null, lastSent = 0, lock = null;
  async function keepAwake() {
    try { if ("wakeLock" in navigator) lock = await navigator.wakeLock.request("screen"); } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (watch !== null && document.visibilityState === "visible") keepAwake(); });
  shareButton.addEventListener("click", () => {
    if (!("geolocation" in navigator)) { sharing.textContent = "This phone's browser can't share location. Send a location pin in WhatsApp instead."; return; }
    shareButton.disabled = true;
    keepAwake();
    watch = navigator.geolocation.watchPosition(async (pos) => {
      if (Date.now() - lastSent < 15000) return;
      lastSent = Date.now();
      try {
        const res = await fetch(base + "/where", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }) });
        const data = await res.json();
        if (data.sharing === false) { navigator.geolocation.clearWatch(watch); sharing.textContent = "This job is finished, so your location is no longer shared."; return; }
        sharing.textContent = "Sharing your location. Last sent " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ". Keep this page open.";
      } catch { sharing.textContent = "No network. Your location will send again when you're back online."; }
    }, (err) => {
      shareButton.disabled = false;
      sharing.textContent = err.code === 1
        ? "Location is blocked. Allow location for this page in your browser settings, then tap the button again."
        : "Couldn't get your location. Check that location is switched on, then try again.";
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  });
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", async () => {
    const step = b.dataset.step;
    if (step !== "picked_up" && !confirm(step === "delivered" ? "Mark this order as delivered?" : "Tell the business you couldn't deliver it?")) return;
    b.disabled = true;
    try {
      const res = await fetch(base + "/step", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step }) });
      const data = await res.json();
      status.textContent = data.changed ? "Done. The customer and the business have been told." : "Already updated earlier.";
      if (step !== "picked_up" && watch !== null) navigator.geolocation.clearWatch(watch);
    } catch { status.textContent = "No network. Please tap again when you're back online."; }
    b.disabled = false;
  }));
})();
</script>`,
  );
}

function words(status: Delivery["status"]): string {
  return { assigned: "waiting for pickup", picked_up: "on the way", delivered: "delivered", failed: "not delivered", cancelled: "cancelled" }[
    status as string
  ] ?? status;
}

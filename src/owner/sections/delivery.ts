import type { Hono } from "hono";
import { currencySign, formatMoney, parseMoney, type Currency } from "../../core/money.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { normaliseWaId } from "../auth.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import type { LiveDelivery } from "../store.js";
import type { Env } from "../types.js";

// Delivery zones (areas and their fee) and the business's riders. The bot
// prices delivery from these zones, never from the AI, and the owner sends a
// rider out from WhatsApp ("rider KP-1001 Musa").

const UUID = /^[0-9a-f-]{36}$/;

/** A rider's position older than this is shown as "may have closed their page". Same as the customer's map. */
export const STALE_MINUTES = 30;

/** What the live view's browser code gets: plain values, no WhatsApp numbers beyond what the page already shows. */
export function liveJson(list: LiveDelivery[], now: Date) {
  return list.map((d) => ({
    ref: d.orderRef,
    status: d.status,
    rider: d.riderName,
    riderPhone: d.riderWaId,
    customer: d.customerName ?? showWaId(d.customerWaId),
    address: d.address,
    drop: d.drop,
    at: d.rider ? { lat: d.rider.lat, lng: d.rider.lng, minutes: Math.max(0, Math.floor((now.getTime() - d.rider.seenAt.getTime()) / 60_000)) } : null,
    track: d.trackLink ?? null,
  }));
}

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

/** The "Out for delivery now" block: a map of riders and a list that refresh every 15 seconds. */
function liveSection(initial: ReturnType<typeof liveJson>): string {
  const data = JSON.stringify(initial).replace(/</g, "\\u003c");
  return `<h2>Out for delivery now</h2>
<p class="muted">Riders show on the map while their delivery page is open on their phone. It updates every 15 seconds, the same as the customer's tracking page.</p>
<link rel="stylesheet" href="${LEAFLET_CSS}" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
<div id="livemap" class="livemap" hidden></div>
<div id="livelist" class="livelist"></div>
<script src="${LEAFLET_JS}" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script>
(() => {
  const STALE = ${STALE_MINUTES};
  const list = document.getElementById("livelist");
  const box = document.getElementById("livemap");
  let map = null, layer = null, framed = false;
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
  const ago = (m) => (m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.floor(m / 60) + " h " + (m % 60) + " min ago");
  function draw(items) {
    if (!items.length) {
      list.innerHTML = '<p class="muted">No deliveries on the road right now. When you send a rider out (<code>rider KP-1001 Musa</code> on WhatsApp), the job shows here.</p>';
      box.hidden = true;
      return;
    }
    list.innerHTML = items.map((d) => {
      const fresh = d.at && d.at.minutes < STALE;
      const where = !d.at ? '<span class="muted">Not sharing location yet: ask ' + esc(d.rider || "the rider") + ' to open their job link and tap Start sharing.</span>'
        : fresh ? '<span class="dot lime"></span> Seen ' + ago(d.at.minutes) + ' · <a href="https://www.google.com/maps/search/?api=1&query=' + d.at.lat + ',' + d.at.lng + '" target="_blank" rel="noopener">Open in Google Maps</a>'
        : '<span class="dot amber"></span> Last seen ' + ago(d.at.minutes) + ': their page may be closed.';
      return '<div class="card live"><div class="livehead"><b>' + esc(d.ref) + '</b><span class="tag ' + (d.status === "picked_up" ? "lime" : "") + '">' + (d.status === "picked_up" ? "On the way" : "Waiting for pickup") + '</span></div>'
        + '<p class="small" style="margin:6px 0">' + esc(d.rider || "Rider") + (d.riderPhone ? ' · <a href="tel:+' + esc(d.riderPhone) + '">call</a>' : '') + ' → ' + esc(d.customer) + (d.address ? ', ' + esc(d.address) : '') + '</p>'
        + '<p class="small" style="margin:0">' + where + '</p>'
        + (d.track ? '<p class="small" style="margin:6px 0 0"><a href="' + esc(d.track) + '" target="_blank" rel="noopener">Customer’s tracking page</a></p>' : '')
        + '</div>';
    }).join("");
    if (!window.L) return;
    const points = items.filter((d) => d.at || d.drop);
    box.hidden = points.length === 0;
    if (!points.length) return;
    if (!map) {
      map = L.map(box, { zoomControl: true }).setView([6.5244, 3.3792], 11);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    const bounds = [];
    for (const d of items) {
      if (d.drop) { L.circleMarker([d.drop.lat, d.drop.lng], { radius: 6, color: "#0a0d0b", weight: 2, fillColor: "#f3f1e6", fillOpacity: 1 }).addTo(layer).bindTooltip(esc(d.ref) + " drop-off"); bounds.push([d.drop.lat, d.drop.lng]); }
      if (d.at) {
        const fresh = d.at.minutes < STALE;
        L.circleMarker([d.at.lat, d.at.lng], { radius: 10, color: "#0a0d0b", weight: 2, fillColor: fresh ? "#c6ff1f" : "#9aa39d", fillOpacity: 1 })
          .addTo(layer).bindTooltip(esc(d.rider || "Rider") + " · " + esc(d.ref), { permanent: fresh, direction: "top", offset: [0, -8] });
        bounds.push([d.at.lat, d.at.lng]);
      }
    }
    if (!framed && bounds.length) { map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 }); framed = true; }
    setTimeout(() => map.invalidateSize(), 0);
  }
  draw(${data});
  setInterval(async () => {
    try {
      const res = await fetch("/app/delivery/live", { cache: "no-store", credentials: "same-origin" });
      if (res.ok) draw(await res.json());
    } catch {}
  }, 15000);
})();
</script>`;
}

/** "Lekki, Ajah; VI" -> ["lekki", "ajah", "vi"] */
export function readAreas(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((a) => a.trim().toLowerCase()).filter((a) => a.length >= 2 && a.length <= 60))].slice(0, 50);
}

export function registerDelivery(app: Hono<Env>, ctx: SectionContext) {
  app.get("/delivery", async (c) => {
    const biz = c.get("biz");
    if (!biz.delivery) {
      return ctx.render(
        c,
        "Riders & delivery",
        "/app/delivery",
        `<p>Delivery isn't switched on for your business yet. With it on, the bot asks customers for their address or location, adds your delivery fee from the zones you set here, and you send your own riders out from WhatsApp with live tracking for the customer.</p>
<p>Ask yarnOga support to switch it on: <a href="/app/help">Help</a>.</p>`,
      );
    }
    if (biz.features && !(await biz.features.has("delivery"))) {
      return ctx.render(c, "Riders & delivery", "/app/delivery", `<p>Delivery comes with Pro and above. Send <b>plan</b> to your bot on WhatsApp to upgrade.</p>`);
    }
    const [zones, riders, live] = await Promise.all([
      biz.delivery.zones(),
      biz.delivery.riders(),
      // The live list is extra: if it can't load, the rest of the page still works.
      biz.delivery.onTheRoad ? biz.delivery.onTheRoad().catch(() => null) : Promise.resolve(null),
    ]);
    const owner = c.get("user").role === "owner";
    const zoneRows = zones
      .map(
        (z) => `<tr><td><b>${esc(z.name)}</b><br><span class="muted small">${esc(z.areas.join(", ") || "no areas yet")}</span></td><td>${formatMoney(z.feeKobo, biz.currency)}</td>
<td>${owner ? `<details><summary class="small">Change</summary><form method="post" action="/app/delivery/zones/${z.id}">
<label>Name<input name="name" value="${esc(z.name)}" required maxlength="60"></label>
<label>Areas <span class="muted">(separate with commas)</span><textarea name="areas">${esc(z.areas.join(", "))}</textarea></label>
<label>Fee (${currencySign(biz.currency)})<input name="fee" inputmode="decimal" value="${(z.feeKobo / 100).toFixed(2).replace(/\.00$/, "")}" required></label>
<div class="actions"><button class="small">Save</button></div></form>
<form method="post" action="/app/delivery/zones/${z.id}/remove" style="margin-top:8px"><button class="danger small">Remove zone</button></form></details>` : ""}</td></tr>`,
      )
      .join("");
    const riderRows = riders
      .map(
        (r) => `<tr><td>${esc(r.name)}</td><td>${esc(showWaId(r.waId))}</td><td>${owner ? `<form method="post" action="/app/delivery/riders/${r.id}/remove"><button class="danger small">Remove</button></form>` : ""}</td></tr>`,
      )
      .join("");
    return ctx.render(
      c,
      "Riders & delivery",
      "/app/delivery",
      `${live ? liveSection(liveJson(live, ctx.now())) : ""}
<h2>Delivery zones and fees</h2>
<p class="muted">A customer's address is matched to a zone by the area names in it; the longest match wins ("Lekki Phase 1" before "Lekki"). An address in no zone is sent to you to price.</p>
<div class="scroll"><table><tr><th>Zone and areas</th><th>Fee</th><th></th></tr>${zoneRows || `<tr><td colspan="3" class="muted">No zones yet.</td></tr>`}</table></div>
${owner ? `<details class="card" style="margin-top:12px"><summary><b>Add a zone</b></summary><form method="post" action="/app/delivery/zones">
<label>Name<input name="name" required maxlength="60" placeholder="e.g. Island"></label>
<label>Areas <span class="muted">(separate with commas)</span><textarea name="areas" placeholder="Lekki, Ajah, Victoria Island, VI, Ikoyi"></textarea></label>
<label>Fee (${currencySign(biz.currency)})<input name="fee" inputmode="decimal" required placeholder="2500"></label>
<div class="actions"><button>Add zone</button></div></form></details>` : ""}
<h2>Riders</h2>
<p class="muted">Riders get the pickup and drop-off on WhatsApp, and share their location so the customer can follow the delivery.</p>
<div class="scroll"><table><tr><th>Name</th><th>WhatsApp</th><th></th></tr>${riderRows || `<tr><td colspan="3" class="muted">No riders yet.</td></tr>`}</table></div>
${owner ? `<details class="card" style="margin-top:12px"><summary><b>Add a rider</b></summary><form method="post" action="/app/delivery/riders">
<div class="row"><label>Name<input name="name" required maxlength="60"></label><label>WhatsApp number<input name="wa" inputmode="tel" required placeholder="0801 234 5678"></label></div>
<div class="actions"><button>Add rider</button></div></form></details>` : `<p class="muted small">Only the owner can change zones and riders.</p>`}
<p class="muted small" style="margin-top:20px">To send a rider out: on WhatsApp, send <code>rider ${esc(biz.orderPrefix)}-1001 Musa</code>. Ask each new rider to send <b>hi</b> to your business number once, so WhatsApp lets job messages through. When no zone matches an address, send <code>fee ${esc(biz.orderPrefix)}-1001 2500</code>.</p>`,
    );
  });

  // The live list, for the page to refresh itself. Staff can see it too.
  app.get("/delivery/live", async (c) => {
    const store = c.get("biz").delivery;
    if (!store?.onTheRoad) return c.json([]);
    return c.json(liveJson(await store.onTheRoad(), ctx.now()), 200, { "Cache-Control": "no-store" });
  });

  // Changes are owner-only.
  app.use("/delivery/*", async (c, next) => {
    if (c.req.method === "POST" && c.get("user").role !== "owner") return c.redirect("/app/delivery?msg=owner_only", 303);
    if (!c.get("biz").delivery) return c.redirect("/app/delivery", 303);
    await next();
  });

  const readZone = (form: Record<string, unknown>, currency: Currency) => {
    const name = field(form, "name", 60);
    const fee = parseMoney(field(form, "fee", 20), currency);
    return name && fee !== null ? { name, areas: readAreas(field(form, "areas", 3000)), feeKobo: fee } : null;
  };

  app.post("/delivery/zones", async (c) => {
    const zone = readZone(await c.req.parseBody(), c.get("biz").currency);
    if (!zone) return c.redirect("/app/delivery?msg=bad", 303);
    await c.get("biz").delivery!.saveZone(null, zone);
    return c.redirect("/app/delivery?msg=added", 303);
  });

  app.post("/delivery/zones/:id", async (c) => {
    const zone = readZone(await c.req.parseBody(), c.get("biz").currency);
    if (!zone || !UUID.test(c.req.param("id"))) return c.redirect("/app/delivery?msg=bad", 303);
    await c.get("biz").delivery!.saveZone(c.req.param("id"), zone);
    return c.redirect("/app/delivery?msg=saved", 303);
  });

  app.post("/delivery/zones/:id/remove", async (c) => {
    if (UUID.test(c.req.param("id"))) await c.get("biz").delivery!.removeZone(c.req.param("id"));
    return c.redirect("/app/delivery?msg=removed", 303);
  });

  app.post("/delivery/riders", async (c) => {
    const form = await c.req.parseBody();
    const name = field(form, "name", 60);
    const waId = normaliseWaId(field(form, "wa", 30));
    if (!name || !waId) return c.redirect("/app/delivery?msg=bad", 303);
    await c.get("biz").delivery!.addRider(name, waId);
    return c.redirect("/app/delivery?msg=added", 303);
  });

  app.post("/delivery/riders/:id/remove", async (c) => {
    if (UUID.test(c.req.param("id"))) await c.get("biz").delivery!.removeRider(c.req.param("id"));
    return c.redirect("/app/delivery?msg=removed", 303);
  });
}

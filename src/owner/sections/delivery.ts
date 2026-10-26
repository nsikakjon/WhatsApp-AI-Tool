import type { Hono } from "hono";
import { currencySign, formatMoney, parseMoney, type Currency } from "../../core/money.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { normaliseWaId } from "../auth.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import type { Env } from "../types.js";

// Delivery zones (areas and their fee) and the business's riders. The bot
// prices delivery from these zones, never from the AI, and the owner sends a
// rider out from WhatsApp ("rider KP-1001 Musa").

const UUID = /^[0-9a-f-]{36}$/;

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
    const [zones, riders] = await Promise.all([biz.delivery.zones(), biz.delivery.riders()]);
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
      `<h2>Delivery zones and fees</h2>
<p class="muted">A customer's address is matched to a zone by the area names in it; the longest match wins ("Lekki Phase 1" before "Lekki"). An address in no zone is sent to you to price.</p>
<div class="scroll"><table><tr><th>Zone and areas</th><th>Fee</th><th></th></tr>${zoneRows || `<tr><td colspan="3" class="muted">No zones yet.</td></tr>`}</table></div>
${owner ? `<details class="card" style="margin-top:12px"><summary><b>+ Add a zone</b></summary><form method="post" action="/app/delivery/zones">
<label>Name<input name="name" required maxlength="60" placeholder="e.g. Island"></label>
<label>Areas <span class="muted">(separate with commas)</span><textarea name="areas" placeholder="Lekki, Ajah, Victoria Island, VI, Ikoyi"></textarea></label>
<label>Fee (${currencySign(biz.currency)})<input name="fee" inputmode="decimal" required placeholder="2500"></label>
<div class="actions"><button>Add zone</button></div></form></details>` : ""}
<h2>Riders</h2>
<p class="muted">Riders get the pickup and drop-off on WhatsApp, and share their location so the customer can follow the delivery.</p>
<div class="scroll"><table><tr><th>Name</th><th>WhatsApp</th><th></th></tr>${riderRows || `<tr><td colspan="3" class="muted">No riders yet.</td></tr>`}</table></div>
${owner ? `<details class="card" style="margin-top:12px"><summary><b>+ Add a rider</b></summary><form method="post" action="/app/delivery/riders">
<div class="row"><label>Name<input name="name" required maxlength="60"></label><label>WhatsApp number<input name="wa" inputmode="tel" required placeholder="0801 234 5678"></label></div>
<div class="actions"><button>Add rider</button></div></form></details>` : `<p class="muted small">Only the owner can change zones and riders.</p>`}
<p class="muted small" style="margin-top:20px">To send a rider out: on WhatsApp, send <code>rider ${esc(biz.orderPrefix)}-1001 Musa</code>. Ask each new rider to send <b>hi</b> to your business number once, so WhatsApp lets job messages through. When no zone matches an address, send <code>fee ${esc(biz.orderPrefix)}-1001 2500</code>.</p>`,
    );
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

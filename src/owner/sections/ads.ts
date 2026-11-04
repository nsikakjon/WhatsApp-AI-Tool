import type { Hono } from "hono";
import { AD_REPORT_DAYS, summariseAds, type AdResult } from "../../core/ads.js";
import type { SectionContext } from "../index.js";
import { esc, stat } from "../layout.js";
import type { AdOrder } from "../store.js";
import type { Env } from "../types.js";

// Ads (AD_LEADS, owners only): the people each Click-to-WhatsApp ad brought to
// the business's number, and how many of them went on to get a quote or order.
// A quote or order counts for an ad when it came after the person's first
// message from that ad.

export interface AdRow extends AdResult {
  quoted: number;
  ordered: number;
}

/** Adds to each ad how many of its people got a quote, and how many ordered (confirmed or paid). */
export function withOrders(ads: AdResult[], orders: AdOrder[]): AdRow[] {
  return ads.map((ad) => {
    const quoted = new Set<string>();
    const ordered = new Set<string>();
    for (const o of orders) {
      const first = ad.firstBy.get(o.contactId);
      if (!first || o.createdAt < first) continue;
      quoted.add(o.contactId);
      if (o.status === "confirmed" || o.status === "paid") ordered.add(o.contactId);
    }
    return { ...ad, quoted: quoted.size, ordered: ordered.size };
  });
}

export function registerAds(app: Hono<Env>, ctx: SectionContext) {
  app.use("/ads", async (c, next) => (c.get("biz").ads ? ((await ctx.ownerOnly(c)) ?? next()) : c.notFound()));

  app.get("/ads", async (c) => {
    const biz = c.get("biz");
    const now = ctx.now();
    const ads = summariseAds(await biz.ads!.leads(now), now);
    const people = [...new Set(ads.flatMap((a) => [...a.firstBy.keys()]))];
    let earliest = now;
    for (const ad of ads) for (const at of ad.firstBy.values()) if (at < earliest) earliest = at;
    const rows = withOrders(ads, people.length ? await biz.ads!.orders(people, earliest) : []);
    const n = (x: number) => x.toLocaleString("en-NG");
    const sum = (k: "leads7" | "leads30" | "freeNow" | "ordered") => rows.reduce((t, r) => t + r[k], 0);

    const table = rows.length
      ? `<div class="scroll"><table><tr><th>Ad</th><th>Last 7 days</th><th>Last 30 days</th><th>${AD_REPORT_DAYS} days</th><th>Got a quote</th><th>Ordered</th><th>Free now</th></tr>
${rows
  .map((r) => {
    const name = r.headline ?? (r.sourceType === "post" ? "Facebook post" : "Ad with no headline");
    const link = r.sourceUrl && /^https:\/\//.test(r.sourceUrl) ? ` <a class="small" href="${esc(r.sourceUrl)}" rel="noopener noreferrer" target="_blank">See the ad</a>` : "";
    return `<tr><td><b>${esc(name)}</b>${link}<br><span class="muted small">Ad ID ${esc(r.sourceId)}</span></td><td>${n(r.leads7)}</td><td>${n(r.leads30)}</td><td>${n(r.leads)}</td><td>${n(r.quoted)}</td><td><b>${n(r.ordered)}</b></td><td>${n(r.freeNow)}</td></tr>`;
  })
  .join("")}</table></div>`
      : `<p class="muted">No one has messaged you from an ad yet. When someone taps one of your Click-to-WhatsApp ads on Facebook or Instagram and sends a message, they show here.</p>`;

    const body = `<p>People who messaged you by tapping one of your Click-to-WhatsApp ads, ad by ad. Each person is counted once per ad, however many messages they send.</p>
<div class="grid">
${stat("Leads this week", n(sum("leads7")), `${n(sum("leads30"))} in the last 30 days`, { glow: true, icon: "megaphone" })}
${stat("Ordered", n(sum("ordered")), `of the people your ads brought in the last ${AD_REPORT_DAYS} days`, { icon: "orders" })}
${stat("Free chats now", n(sum("freeNow")), "every message to them is free", { icon: "whatsapp" })}
</div>
<section class="card" style="margin-top:14px">
  <h3>Your ads</h3>
  ${table}
</section>
<section class="card" style="margin-top:14px">
  <h3>Free messages for 3 days</h3>
  <p class="small">When someone messages you from an ad and your bot answers within a day, WhatsApp doesn't charge for anything sent to that person for the next 72 hours: replies, quotes, receipts, reminders and offers. So following up an ad's leads in those first days costs nothing extra.</p>
  <p class="small">The Ad ID is the same one Meta Ads Manager shows, so you can match these numbers to what each ad cost.</p>
</section>`;
    return ctx.render(c, "Ads", "/home/ads", body);
  });
}

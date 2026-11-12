import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { formatMoney } from "../../core/money.js";
import { BUSINESS_DESIGNS, designMax, isBusinessDesign, previewOf, renderBusinessFlyer, shrinkPhoto, type BusinessDesign, type BusinessItem } from "../../products/flyer/business.js";
import { priceFacts } from "../../products/quote/catalogue.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import { safeColour } from "../posters.js";
import type { ProductRecord } from "../store.js";
import type { AppBusiness, AppContext, Env } from "../types.js";
import { isPhoto } from "./prices.js";

// Business flyers: the owner ticks products from the price list (or adds
// their own pictures), types a headline, and sees it on every design of the
// flyer engine (products/flyer/business.ts). Prices on a flyer are worked
// out here from the price list, never typed.

const MAX_PRODUCTS = 8;
const OWN_PHOTOS = 4;
const MAX_PHOTO = 5 * 1024 * 1024;
const HOUR = 3_600_000;
const MAX_DRAFTS = 200;

const WORDS = {
  en: { from: "from", order: "Order on WhatsApp", headline: "Available now" },
  fr: { from: "dès", order: "Commandez sur WhatsApp", headline: "Disponible maintenant" },
};

/** A flyer being made: what the owner chose, kept in memory for an hour so they can try every design. */
interface Draft {
  businessId: string;
  at: number;
  headline: string;
  subline: string;
  productIds: string[];
  own: Array<{ photo: Buffer; label: string }>;
  prices: boolean;
  colour: string;
  /** Finished flyers, by design. */
  made: Map<BusinessDesign, Buffer>;
}

/** What a flyer shows as a product's price: the price of one, or the lowest when it depends on the option or quantity. Null: priced by the team. */
export function flyerPrice(product: Pick<ProductRecord, "options">): { kobo: number; from: boolean } | null {
  const facts = product.options.flatMap((o, i) => {
    if (o.stock === 0) return [];
    const f = priceFacts({ id: o.id ?? String(i), name: o.name, minQuantity: o.minQuantity, tiers: o.tiers });
    return f ? [f] : [];
  });
  if (!facts.length) return null;
  const kobo = Math.min(...facts.map((f) => f.bulk?.unitKobo ?? f.unitKobo));
  return { kobo, from: facts.length > 1 || facts[0]!.bulk !== null };
}

/** "2347048971600" -> "0704 897 1600"; other countries' numbers keep their code: "+254 712345678". */
export function flyerNumber(digits: string): string {
  const ng = digits.match(/^234(\d{3})(\d{3})(\d{4})$/);
  if (ng) return `0${ng[1]} ${ng[2]} ${ng[3]}`;
  return `+${digits.slice(0, 3)} ${digits.slice(3)}`;
}

export function registerFlyers(app: Hono<Env>, ctx: SectionContext) {
  for (const path of ["/flyers", "/flyers/*"]) app.use(path, async (c, next) => (await ctx.need(c, "tools")) ?? next());

  const drafts = new Map<string, Draft>();
  const draftOf = (c: AppContext): Draft | null => {
    const draft = drafts.get(c.req.param("draft") ?? "");
    return draft && draft.businessId === c.get("biz").id && ctx.now().getTime() - draft.at < HOUR ? draft : null;
  };
  const keep = (id: string, draft: Draft) => {
    const cutoff = ctx.now().getTime() - HOUR;
    for (const [key, d] of drafts) if (d.at < cutoff) drafts.delete(key);
    while (drafts.size >= MAX_DRAFTS) drafts.delete(drafts.keys().next().value!);
    drafts.set(id, draft);
  };

  const shopAccent = async (biz: AppBusiness) => (await ctx.deps.shop?.look?.get(biz.id).catch(() => null))?.accent ?? null;

  const form = async (c: AppContext, problems: string[] = [], draftId = "") => {
    const biz = c.get("biz");
    const draft = drafts.get(draftId)?.businessId === biz.id ? drafts.get(draftId)! : null;
    const words = WORDS[biz.language === "fr" ? "fr" : "en"];
    const products = (await biz.prices.products()).filter((p) => p.active);
    const picked = new Set(draft ? draft.productIds : [c.req.query("p") ?? ""]);
    const colour = draft?.colour ?? safeColour(await shopAccent(biz));
    const list = products
      .map((p) => {
        const price = flyerPrice(p);
        const photo = p.photoPath && biz.photos ? `<img class="thumb" src="/home/prices/${p.id}/photo" alt="" loading="lazy">` : `<div class="thumb">${esc(p.name.slice(0, 1).toUpperCase())}</div>`;
        return `<label class="card product" style="cursor:pointer"><input type="checkbox" name="product" value="${p.id}"${picked.has(p.id) ? " checked" : ""}>${photo}<div style="min-width:0"><b>${esc(p.name)}</b>
<p class="muted small" style="margin:0">${price ? `${price.from ? "from " : ""}${formatMoney(price.kobo, biz.currency)}` : "priced by the team"}${p.photoPath ? "" : " · no photo yet"}</p></div></label>`;
      })
      .join("");
    const own = Array.from({ length: OWN_PHOTOS }, (_, i) => `<div class="row"><label>Picture ${i + 1}<input type="file" name="own${i}" accept="image/jpeg,image/png"></label><label>What it shows <span class="muted">(optional)</span><input name="label${i}" maxlength="40" value="${esc(draft?.own[i]?.label ?? "")}" placeholder="e.g. Bridal make-up"></label></div>`).join("");
    return ctx.render(
      c,
      "Flyers",
      "/home/flyers",
      `<p>Make a flyer for your WhatsApp status, Instagram or a customer's chat. Pick what to show, type a headline, and you'll see it on ${BUSINESS_DESIGNS.length} designs with your logo and number.</p>
${problems.length ? `<div class="flash bad"><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
<form method="post" action="/home/flyers" enctype="multipart/form-data">
${draft ? `<input type="hidden" name="draft" value="${esc(draftId)}">` : ""}
<label for="h">Headline</label><input id="h" name="headline" maxlength="40" required value="${esc(draft?.headline ?? words.headline)}">
<label for="s">Line under it <span class="muted">(optional)</span></label><input id="s" name="subline" maxlength="70" value="${esc(draft?.subline ?? "")}" placeholder="e.g. Order before Friday, free delivery in Lekki">
<h2>From your price list</h2>
${products.length ? `<p class="muted small">Tick up to ${MAX_PRODUCTS}. Photos, names and prices come from your <a href="/home/prices">price list</a>.</p><div class="cards">${list}</div>` : `<p class="muted">Your price list is empty. <a href="/home/prices/new">Add a product</a>, or use your own pictures below.</p>`}
<h2>Your own pictures</h2>
<p class="muted small">For a service or anything not on your price list. JPEG or PNG, up to 5 MB each.${draft?.own.length ? ` Your ${draft.own.length === 1 ? "picture" : `${draft.own.length} pictures`} from before ${draft.own.length === 1 ? "is" : "are"} kept unless you choose new ones.` : ""}</p>
${own}
<div class="row"><label class="check"><input type="checkbox" name="prices"${!draft || draft.prices ? " checked" : ""}> Show prices</label>
<label>Colour<input type="color" name="colour" value="${esc(colour)}" style="height:44px"></label></div>
<div class="actions"><button>See my flyers</button></div></form>`,
      problems.length ? 400 : 200,
    );
  };

  app.get("/flyers", (c) => form(c, [], c.req.query("from") ?? ""));

  app.post("/flyers", async (c) => {
    const biz = c.get("biz");
    const body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
    const before = drafts.get(field(body, "draft", 40));
    const earlier = before?.businessId === biz.id ? before : null;
    const problems: string[] = [];
    const headline = field(body, "headline", 40);
    if (!headline) problems.push("Type a headline.");
    const ticked = [body.product].flat().filter((v): v is string => typeof v === "string");
    if (ticked.length > MAX_PRODUCTS) problems.push(`Tick up to ${MAX_PRODUCTS} products.`);
    const known = new Set((await biz.prices.products()).filter((p) => p.active).map((p) => p.id));
    const productIds = ticked.filter((id) => known.has(id)).slice(0, MAX_PRODUCTS);

    const own: Draft["own"] = [];
    for (let i = 0; i < OWN_PHOTOS; i++) {
      const file = body[`own${i}`];
      if (!(file instanceof File) || file.size === 0) continue;
      const data = new Uint8Array(await file.arrayBuffer());
      if (file.size > MAX_PHOTO || !isPhoto(data)) {
        problems.push(`Picture ${i + 1} must be a JPEG or PNG under 5 MB.`);
        continue;
      }
      try {
        own.push({ photo: await shrinkPhoto(data), label: field(body, `label${i}`, 40) });
      } catch {
        problems.push(`Picture ${i + 1} couldn't be opened. Try another one.`);
      }
    }
    const kept = own.length ? own : (earlier?.own ?? []).map((o, i) => ({ ...o, label: field(body, `label${i}`, 40) }));
    if (!productIds.length && !kept.length) problems.push("Tick a product or add a picture.");
    if (problems.length) return form(c, problems, earlier ? field(body, "draft", 40) : "");

    const id = randomBytes(12).toString("hex");
    keep(id, {
      businessId: biz.id,
      at: ctx.now().getTime(),
      headline,
      subline: field(body, "subline", 70),
      productIds,
      own: kept,
      prices: Boolean(body.prices),
      colour: safeColour(field(body, "colour", 7)),
      made: new Map(),
    });
    return c.redirect(`/home/flyers/${id}`, 303);
  });

  const expired = (c: AppContext) =>
    ctx.render(c, "Flyers", "/home/flyers", `<p>This flyer was put away after an hour. <a href="/home/flyers">Make it again</a>: it only takes a minute.</p>`, 404);

  const count = (draft: Draft) => draft.productIds.length + draft.own.length;

  app.get("/flyers/:draft", (c) => {
    const draft = draftOf(c);
    if (!draft) return expired(c);
    const id = c.req.param("draft");
    const n = count(draft);
    const cards = BUSINESS_DESIGNS.map(
      (d) => `<a class="card" href="/home/flyers/${id}/${d.id}" style="padding:10px;text-decoration:none;color:inherit">
<img src="/home/flyers/${id}/${d.id}.jpg?small=1" alt="${d.name} design" width="540" height="675" loading="lazy" style="width:100%;height:auto;border-radius:12px;display:block">
<p style="margin:10px 4px 0"><b>${d.name}</b> <span class="muted small">${n > d.max ? `shows the first ${d.max === 1 ? "one" : d.max}` : esc(d.about)}</span></p></a>`,
    ).join("");
    return ctx.render(
      c,
      "Pick a design",
      "/home/flyers",
      `<p>Tap the one you like to share or download it.</p>
<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${cards}</div>
<div class="actions"><a class="button ghost" href="/home/flyers?from=${id}">Change the words or pictures</a></div>`,
    );
  });

  app.get("/flyers/:draft/:file{[a-z]+\\.jpg}", async (c) => {
    const draft = draftOf(c);
    const design = c.req.param("file").replace(".jpg", "");
    if (!draft || !isBusinessDesign(design)) return c.notFound();
    let jpeg = draft.made.get(design);
    if (!jpeg) {
      try {
        jpeg = await make(c.get("biz"), draft, design);
      } catch (err) {
        ctx.log.error("Owner app: drawing a business flyer failed:", err);
        return c.text("The flyer couldn't be drawn. Please try again.", 500);
      }
      draft.made.set(design, jpeg);
    }
    const out = c.req.query("small") ? await previewOf(jpeg) : jpeg;
    return c.body(new Uint8Array(out) as unknown as ArrayBuffer, 200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${c.req.query("save") ? "attachment" : "inline"}; filename="flyer-${design}.jpg"`,
    });
  });

  app.get("/flyers/:draft/:design", (c) => {
    const draft = draftOf(c);
    const design = c.req.param("design");
    if (!draft || !isBusinessDesign(design)) return expired(c);
    const id = c.req.param("draft");
    const src = `/home/flyers/${id}/${design}.jpg`;
    const left = count(draft) - designMax(design);
    return ctx.render(
      c,
      "Your flyer",
      "/home/flyers",
      `<img id="flyer" src="${src}" alt="Your flyer" width="1080" height="1350" style="width:100%;max-width:480px;height:auto;border-radius:14px;display:block">
${left > 0 ? `<p class="muted small">This design shows ${designMax(design) === 1 ? "one product" : `${designMax(design)} products`}, so ${left} of yours ${left === 1 ? "is" : "are"} left off.</p>` : ""}
<div class="actions"><button type="button" id="share" hidden>Share</button><a class="button" id="save" href="${src}?save=1" download="flyer-${design}.jpg">Download</a><a class="button ghost" href="/home/flyers/${id}">Other designs</a><a class="button ghost" href="/home/flyers?from=${id}">Change the words or pictures</a></div>
<p class="muted small">Share opens WhatsApp, Instagram and your other apps: choose "My status" in WhatsApp to post it there.</p>
<script>
(function () {
  var button = document.getElementById("share");
  if (!navigator.canShare) return;
  fetch(${JSON.stringify(src)}).then(function (r) { return r.blob(); }).then(function (blob) {
    var file = new File([blob], "flyer-${design}.jpg", { type: "image/jpeg" });
    if (!navigator.canShare({ files: [file] })) return;
    button.hidden = false;
    document.getElementById("save").classList.add("ghost");
    button.addEventListener("click", function () { navigator.share({ files: [file] }).catch(function () {}); });
  }).catch(function () {});
})();
</script>`,
    );
  });

  const make = async (biz: AppBusiness, draft: Draft, design: BusinessDesign): Promise<Buffer> => {
    const words = WORDS[biz.language === "fr" ? "fr" : "en"];
    const wanted = draft.productIds.slice(0, designMax(design));
    const byId = new Map((await biz.prices.products()).map((p) => [p.id, p]));
    const items: BusinessItem[] = [];
    for (const id of wanted) {
      const p = byId.get(id);
      if (!p) continue;
      const price = draft.prices ? flyerPrice(p) : null;
      const photo = p.photoPath && biz.photos ? await biz.photos.photo(p.photoPath).catch(() => null) : null;
      items.push({ name: p.name, photo: photo?.data, price: price ? formatMoney(price.kobo, biz.currency) : undefined, from: price?.from });
    }
    for (const o of draft.own) items.push({ photo: o.photo, name: o.label || undefined });
    const [info, logo, planCode, link] = await Promise.all([
      biz.data.info().catch(() => null),
      biz.logo().catch(() => null),
      biz.features ? biz.features.planCode().catch(() => null) : null,
      ctx.deps.shop ? ctx.deps.shop.link(biz.id, biz.name).catch(() => null) : null,
    ]);
    return renderBusinessFlyer(design, {
      headline: draft.headline,
      subline: draft.subline || undefined,
      items,
      businessName: info?.name ?? biz.name,
      logo: logo ?? undefined,
      contact: info?.whatsappNumber ? { label: words.order, number: flyerNumber(info.whatsappNumber) } : undefined,
      link: link?.replace(/^https?:\/\//, ""),
      fromWord: words.from,
      accent: draft.colour,
      credit: planCode === "free" ? "Made with yarnOga" : undefined,
    });
  };
}

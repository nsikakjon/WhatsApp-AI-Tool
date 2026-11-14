import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { formatMoney, formatNaira } from "../../core/money.js";
import { BUSINESS_DESIGNS, designMax, HEADLINE_FONTS, isBusinessDesign, isHeadlineFont, previewOf, renderBusinessFlyer, shrinkPhoto, type BusinessDesign, type BusinessItem, type FlyerLook } from "../../products/flyer/business.js";
import { priceFacts } from "../../products/quote/catalogue.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import { safeColour } from "../posters.js";
import type { FlyerStatus } from "../../products/quote/flyer-packs.js";
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
const MAX_MESSAGE = 600;
const HOUR = 3_600_000;
const MAX_DRAFTS = 200;

/** The designs a plan's monthly flyers can use; a flyer pack opens the rest. */
const PLAN_DESIGNS: BusinessDesign[] = ["spotlight", "grid"];

const SIZES = [
  { id: "s", name: "Smaller", scale: 0.85 },
  { id: "m", name: "As designed", scale: 1 },
  { id: "l", name: "Bigger", scale: 1.15 },
];

/** Colours offered beside the shop's own in the design console. */
const SWATCHES = ["#e8541e", "#d62e4c", "#7c3aed", "#1f6feb", "#128c4a", "#c6ff1f", "#ffb800", "#111111"];

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
  /** Touches from the design console, kept when the owner switches design. */
  look: FlyerLook;
  show: { logo: boolean; link: boolean; number: boolean };
  /** Goes up with every change in the console, so the browser fetches the new picture. */
  version: number;
  /**
   * Set once the flyer is counted (see flyer-packs.ts): "plan" is one of a
   * limited plan's monthly flyers (yarnOga tag, plan designs), "pack" came
   * from a flyer pack, and "open" is a plan with no limit.
   */
  pass?: "plan" | "pack" | "open";
  /** How the small previews look, worked out when the designs page opens. */
  preview: { tag: boolean; mark: boolean };
  /** Finished flyers, by design and whether they carry the yarnOga tag. */
  made: Map<string, Buffer>;
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
      look: earlier?.look ?? {},
      show: earlier?.show ?? { logo: true, link: true, number: true },
      version: 0,
      pass: biz.flyers ? undefined : "open",
      preview: { tag: false, mark: false },
      made: new Map(),
    });
    return c.redirect(`/home/flyers/${id}`, 303);
  });

  const expired = (c: AppContext) =>
    ctx.render(c, "Flyers", "/home/flyers", `<p>This flyer was put away after an hour. <a href="/home/flyers">Make it again</a>: it only takes a minute.</p>`, 404);

  const count = (draft: Draft) => draft.productIds.length + draft.own.length;

  /** How the small previews look: a limited plan's uncounted flyer says "Preview" across it, and a free flyer carries the yarnOga tag. */
  const setPreview = async (biz: AppBusiness, draft: Draft, status: FlyerStatus | null) => {
    const limited = status && status.planLimit != null ? status : null;
    const freeBefore0082 = !limited && biz.features ? (await biz.features.planCode().catch(() => null)) === "free" : false;
    draft.preview = { tag: freeBefore0082 || (Boolean(limited) && draft.pass !== "pack" && limited!.packLeft === 0), mark: Boolean(limited) && !draft.pass };
  };

  /** Whether opening this design spends a flyer: not counted yet, or counted on the plan but outside its designs. */
  const uncounted = (draft: Draft, design: BusinessDesign) => !draft.pass || (draft.pass === "plan" && !PLAN_DESIGNS.includes(design));

  /** Whether a design needs a flyer pack: on a limited plan, with no pack flyer in hand, it isn't one of the plan's designs. */
  const locked = (design: BusinessDesign, draft: Draft, status: FlyerStatus | null) =>
    Boolean(status && status.planLimit != null && draft.pass !== "pack" && status.packLeft === 0 && !PLAN_DESIGNS.includes(design));

  const packForms = async (c: AppContext, back: string) => {
    const packs = await c.get("biz").flyers!.packs().catch(() => []);
    if (!packs.length) return `<p>Send <b>plan</b> to your bot on WhatsApp to upgrade: paid plans make any number of flyers on every design, with no yarnOga tag.</p>`;
    if (c.get("user").role !== "owner") return `<p>Ask the owner to buy a flyer pack from this page.</p>`;
    return `${packs
      .map(
        (p) => `<form method="post" action="/home/flyers/pack" class="card"><input type="hidden" name="pack" value="${esc(p.code)}"><input type="hidden" name="back" value="${esc(back)}">
<p style="margin:0"><b>${esc(p.name)}</b> for ${formatNaira(p.priceKobo)}</p><p class="muted small" style="margin:4px 0 0">Every design, no yarnOga tag. They don't run out at the end of the month.</p>
<div class="actions"><button>Buy ${esc(p.name)}</button></div></form>`,
      )
      .join("")}
<p class="muted small">Or send <b>plan</b> to your bot on WhatsApp to upgrade: paid plans make any number of flyers.</p>`;
  };

  app.get("/flyers/:draft", async (c) => {
    const draft = draftOf(c);
    if (!draft) return expired(c);
    const id = c.req.param("draft");
    const n = count(draft);
    const status = (await c.get("biz").flyers?.status()) ?? null;
    const limited = status && status.planLimit != null ? status : null;
    await setPreview(c.get("biz"), draft, status);
    const left = !limited
      ? ""
      : draft.pass === "pack" || limited.packLeft > 0
        ? `<p class="flash good">${draft.pass === "pack" ? "This flyer is from your flyer pack" : `You have ${limited.packLeft} pack flyer${limited.packLeft === 1 ? "" : "s"} left`}: every design, no yarnOga tag.</p>`
        : `<p class="flash good">${draft.pass === "plan" ? "This flyer is counted." : `${limited.planLeft} of ${limited.planLimit} free flyers left this month.`} Free flyers use the ${PLAN_DESIGNS.map((d) => BUSINESS_DESIGNS.find((x) => x.id === d)!.name).join(" and ")} designs and carry a small yarnOga tag.</p>`;
    const cards = BUSINESS_DESIGNS.map(
      (d) => `<a class="card" href="/home/flyers/${id}/${d.id}" style="padding:10px;text-decoration:none;color:inherit">
<img src="/home/flyers/${id}/${d.id}.jpg?small=1&v=${draft.version}" alt="${d.name} design" width="540" height="675" loading="lazy" style="width:100%;height:auto;border-radius:12px;display:block">
<p style="margin:10px 4px 0"><b>${d.name}</b> <span class="muted small">${locked(d.id, draft, status) ? "with a flyer pack or a paid plan" : n > d.max ? `shows the first ${d.max === 1 ? "one" : d.max}` : esc(d.about)}</span></p></a>`,
    ).join("");
    return ctx.render(
      c,
      "Pick a design",
      "/home/flyers",
      `${left}<p>Tap the one you like to fine-tune it in the design console, then share or download it.${limited && !draft.pass ? " A flyer is counted when you tap Use this flyer, and you can then switch between its designs." : ""}</p>
<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${cards}</div>
<div class="actions"><a class="button ghost" href="/home/flyers?from=${id}">Change the words or pictures</a></div>`,
    );
  });

  app.get("/flyers/:draft/:file{[a-z]+\\.jpg}", async (c) => {
    const draft = draftOf(c);
    const design = c.req.param("file").replace(".jpg", "");
    if (!draft || !isBusinessDesign(design)) return c.notFound();
    const small = Boolean(c.req.query("small"));
    // The full-size flyer is only for a flyer that has been counted, on a design its pass covers.
    if (!small && (!draft.pass || (draft.pass === "plan" && !PLAN_DESIGNS.includes(design)))) return c.notFound();
    let jpeg: Buffer;
    try {
      jpeg = await flyer(c.get("biz"), draft, design, small ? draft.preview.tag : draft.pass === "plan");
    } catch (err) {
      ctx.log.error("Owner app: drawing a business flyer failed:", err);
      return c.text("The flyer couldn't be drawn. Please try again.", 500);
    }
    const out = small ? await previewOf(jpeg, draft.preview.mark) : jpeg;
    return c.body(new Uint8Array(out) as unknown as ArrayBuffer, 200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${c.req.query("save") ? "attachment" : "inline"}; filename="flyer-${design}.jpg"`,
    });
  });

  /** "Send to your customers" under a finished flyer, with message packs to buy when the messages are short. */
  const sendBox = async (send: NonNullable<AppBusiness["sendFlyer"]>, flyerPath: string, words: string) => {
    const [reach, packs] = await Promise.all([send.reach().catch(() => null), send.packs.packs()]);
    // Nothing to send with and nothing to buy: the shop doesn't have broadcasts.
    if (!reach || (reach.left === 0 && reach.monthly === 0 && !packs.length)) return "";
    const { optedIn, left } = reach;
    const to = Math.min(optedIn, left);
    const people = (n: number) => `${n} customer${n === 1 ? "" : "s"}`;
    const buy = packs.length
      ? `<h3>${left === 0 ? "Buy messages" : "Need more messages?"}</h3>${packs
          .map(
            (p) => `<form method="post" action="/home/flyers/messages" class="card"><input type="hidden" name="pack" value="${esc(p.code)}"><input type="hidden" name="back" value="${esc(flyerPath)}">
<p style="margin:0"><b>${esc(p.name)}</b> for ${formatNaira(p.priceKobo)}</p><p class="muted small" style="margin:4px 0 0">One message sends your flyer to one customer. They don't run out at the end of the month.</p>
<div class="actions"><button class="ghost">Buy ${esc(p.name)}</button></div></form>`,
          )
          .join("")}`
      : "";
    if (optedIn === 0) {
      return `<h2>Send to your customers</h2><p class="muted">Nobody has opted in to your offers yet. Ask customers to send <b>JOIN</b> to your WhatsApp number (put it on your status and receipts), then you can send them your flyers from here.</p>`;
    }
    if (left === 0) {
      return `<h2>Send to your customers</h2><p class="muted">${people(optedIn)} opted in to your offers, and you have no messages left${reach.monthly > 0 ? " this month. More come on the 1st" : ""}.</p>${buy}`;
    }
    return `<h2>Send to your customers</h2>
<form method="post" action="/home/flyers/${flyerPath}/send" onsubmit="return confirm('Send this flyer to ${people(to)} now?')">
<p class="muted small">It goes on WhatsApp to ${to < optedIn ? `the first ${to} of the ${people(optedIn)}` : `the ${people(optedIn)}`} who opted in to your offers. You have ${left} message${left === 1 ? "" : "s"} left.</p>
<label for="m">Message under the flyer</label><textarea id="m" name="message" maxlength="${MAX_MESSAGE}" required>${esc(words)}</textarea>
<div class="actions"><button>Send to ${people(to)}</button></div></form>${left < optedIn ? buy : ""}`;
  };

  app.post("/flyers/messages", async (c) => {
    const denied = await ctx.ownerOnly(c);
    if (denied) return denied;
    const biz = c.get("biz");
    const body = await c.req.parseBody();
    const back = /^[0-9a-f]{24}\/[a-z]+$/.test(field(body, "back", 60)) ? `/home/flyers/${field(body, "back", 60)}` : "/home/flyers";
    try {
      const url = await biz.sendFlyer?.packs.link(field(body, "pack", 60), c.get("user").waId);
      if (url) return c.redirect(url, 303);
    } catch (err) {
      ctx.log.error("Owner app: making a message pack link failed:", err);
    }
    return c.redirect(`${back}?msg=flyer_pack_failed`, 303);
  });

  app.post("/flyers/pack", async (c) => {
    const denied = await ctx.ownerOnly(c);
    if (denied) return denied;
    const biz = c.get("biz");
    const body = await c.req.parseBody();
    const back = /^[0-9a-f]{24}$/.test(field(body, "back", 24)) ? `/home/flyers/${field(body, "back", 24)}` : "/home/flyers";
    try {
      const url = biz.flyers ? await biz.flyers.link(field(body, "pack", 40), c.get("user").waId) : null;
      if (url) return c.redirect(url, 303);
    } catch (err) {
      ctx.log.error("Owner app: couldn't make a flyer pack link:", err);
    }
    return c.redirect(`${back}?msg=flyer_pack_failed`, 303);
  });

  const offer = async (c: AppContext, id: string, why: string) =>
    ctx.render(c, "Flyer packs", "/home/flyers", `<p>${why}</p>${await packForms(c, id)}<div class="actions"><a class="button ghost" href="/home/flyers/${id}">Back to the designs</a></div>`);

  /** Counts the flyer (a plan flyer or a pack flyer). Returns a page to show instead when it can't be counted. */
  const spend = async (c: AppContext, draft: Draft, id: string, status: FlyerStatus): Promise<Response | null> => {
    let paidBy: "plan" | "pack" | null;
    try {
      paidBy = await c.get("biz").flyers!.use();
    } catch (err) {
      ctx.log.error("Owner app: counting a flyer failed:", err);
      return ctx.render(c, "Flyers", "/home/flyers", `<p>The flyer couldn't be opened just now. <a href="/home/flyers/${id}">Go back and try again</a>.</p>`);
    }
    if (!paidBy) return offer(c, id, `You've made your ${status.planLimit} free flyers for this month. More come on the 1st.`);
    draft.pass = status.planLimit == null ? "open" : paidBy;
    return null;
  };

  /** The flyer in one design, with the design console beside it. On a limited plan it stays a preview until the owner taps Use this flyer. */
  app.get("/flyers/:draft/:design", async (c) => {
    const draft = draftOf(c);
    const design = c.req.param("design");
    if (!draft || !isBusinessDesign(design)) return expired(c);
    const id = c.req.param("draft");
    const biz = c.get("biz");
    const status = (await biz.flyers?.status()) ?? null;
    if (status && uncounted(draft, design)) {
      if (locked(design, draft, status)) return offer(c, id, `The ${esc(BUSINESS_DESIGNS.find((d) => d.id === design)!.name)} design comes with a flyer pack or a paid plan.`);
      // With no monthly number there's nothing to save up, so the flyer is counted as it opens.
      if (status.planLimit == null) {
        const stop = await spend(c, draft, id, status);
        if (stop) return stop;
      } else if (status.planLeft === 0 && status.packLeft === 0) {
        return offer(c, id, `You've made your ${status.planLimit} free flyers for this month. More come on the 1st.`);
      }
    }
    await setPreview(biz, draft, status);
    const ready = !uncounted(draft, design);
    const src = `/home/flyers/${id}/${design}.jpg`;
    const left = count(draft) - designMax(design);
    const uses = status && status.packLeft > 0 ? `${status.packLeft} pack flyer${status.packLeft === 1 ? "" : "s"}` : `${status?.planLeft ?? 0} free flyer${status?.planLeft === 1 ? "" : "s"} left this month`;
    const below = ready
      ? `<div class="actions"><button type="button" id="share" hidden>Share</button><a class="button" id="save" href="${src}?save=1" download="flyer-${design}.jpg">Download</a></div>
<p class="muted small">Share opens WhatsApp, Instagram and your other apps: choose "My status" in WhatsApp to post it there.</p>`
      : `<form method="post" action="/home/flyers/${id}/${design}/use"><div class="actions"><button>Use this flyer</button></div>
<p class="muted small">This is a preview. Get it how you like it, then tap Use this flyer: it uses 1 of your ${uses}, and your changes after that are free.</p></form>`;
    const sendForm = ready && biz.sendFlyer && c.get("user").role === "owner" ? await sendBox(biz.sendFlyer, `${id}/${design}`, [draft.headline, draft.subline].filter(Boolean).join(". ")) : "";
    return ctx.render(
      c,
      ready ? "Your flyer" : "Design your flyer",
      "/home/flyers",
      `<div class="studio"><div class="stage">
<img id="flyer" src="${ready ? src : `${src}?small=1`}${ready ? "?" : "&"}v=${draft.version}" alt="Your flyer" width="1080" height="1350">
${left > 0 ? `<p class="muted small">This design shows ${designMax(design) === 1 ? "one product" : `${designMax(design)} products`}, so ${left} of yours ${left === 1 ? "is" : "are"} left off.</p>` : ""}</div>
${consoleForm(draft, id, design, await shopAccent(biz))}
<div class="below">${below}</div></div>
<script>
(function () {
  var form = document.getElementById("look"), img = document.getElementById("flyer");
  var base = img.src.replace(/v=\d+$/, "v="), timer, n = 0;
  document.getElementById("apply").style.display = "none";
  function update() {
    var mine = ++n;
    form.classList.add("busy");
    fetch(form.action + "?live=1", { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (out) { if (mine === n) img.src = base + out.version; })
      .catch(function () { form.submit(); });
  }
  img.addEventListener("load", function () { form.classList.remove("busy"); });
  form.addEventListener("input", function (e) { clearTimeout(timer); timer = setTimeout(update, e.target.type === "text" ? 700 : 300); });
  form.querySelectorAll("[data-colour]").forEach(function (b) {
    b.addEventListener("click", function () { form.colour.value = b.dataset.colour; update(); });
  });${
        ready
          ? `
  // The file to share is fetched ahead each time the picture changes: phones only share straight from a tap.
  var button = document.getElementById("share"), save = document.getElementById("save"), file;
  img.addEventListener("load", function () { save.href = img.src + "&save=1"; });
  if (!navigator.canShare) return;
  function ready() {
    fetch(img.src).then(function (r) { return r.blob(); }).then(function (blob) {
      file = new File([blob], "flyer-${design}.jpg", { type: "image/jpeg" });
      if (!navigator.canShare({ files: [file] })) return;
      button.hidden = false;
      save.classList.add("ghost");
    }).catch(function () {});
  }
  img.addEventListener("load", ready);
  ready();
  button.addEventListener("click", function () { if (file) navigator.share({ files: [file] }).catch(function () {}); });`
          : ""
      }
})();
</script>${sendForm}`,
    );
  });

  /** The design console: design, words, colour, headline font and size, photo position, and what the flyer shows. */
  const consoleForm = (draft: Draft, id: string, design: BusinessDesign, shopColour: string | null) => {
    const look = draft.look;
    const words = !draft.pass || draft.pass === "open";
    const seg = (name: string, options: Array<{ id: string; name: string }>, on: string) =>
      `<div class="seg">${options.map((o) => `<label><input type="radio" name="${name}" value="${o.id}"${o.id === on ? " checked" : ""}><span>${esc(o.name)}</span></label>`).join("")}</div>`;
    const range = (name: string, label: string, min: number, max: number, value: number) =>
      `<label>${label}<input type="range" name="${name}" min="${min}" max="${max}" value="${Math.round(value * 100)}"></label>`;
    const swatches = [...new Set([...(shopColour ? [safeColour(shopColour)] : []), ...SWATCHES])]
      .map((hex, i) => `<button type="button" class="swatch" data-colour="${hex}" style="background:${hex}" title="${i === 0 && shopColour ? "Your shop colour" : hex}" aria-label="${i === 0 && shopColour ? "Your shop colour" : hex}"></button>`)
      .join("");
    const tick = (name: string, label: string, on: boolean) => `<label class="check"><input type="checkbox" name="${name}"${on ? " checked" : ""}> ${label}</label>`;
    return `<form class="console" id="look" method="post" action="/home/flyers/${id}/${design}/look">
<h3>Design</h3><div class="seg">${BUSINESS_DESIGNS.map((d) => `<a href="/home/flyers/${id}/${d.id}"${d.id === design ? ' class="on"' : ""}>${esc(d.name)}</a>`).join("")}</div>
<h3>Words</h3>
${
  words
    ? `<label for="h">Headline</label><input id="h" name="headline" maxlength="40" required value="${esc(draft.headline)}">
<label for="s">Line under it</label><input id="s" name="subline" maxlength="70" value="${esc(draft.subline)}">`
    : `<p class="muted small">“${esc(draft.headline)}”${draft.subline ? ` · ${esc(draft.subline)}` : ""}<br>New words make a new flyer: <a href="/home/flyers?from=${id}">change the words or pictures</a>.</p>`
}
<h3>Colour</h3><div class="swatches">${swatches}<input type="color" name="colour" value="${esc(draft.colour)}" aria-label="Any colour"></div>
<h3>Headline font</h3>${seg("font", [{ id: "", name: "Design's own" }, ...HEADLINE_FONTS], look.font ?? "")}
<h3>Headline size</h3>${seg("size", SIZES, SIZES.find((x) => x.scale === (look.size ?? 1))?.id ?? "m")}
<h3>Photo</h3>
${range("zoom", "Zoom in", 100, 200, look.zoom ?? 1)}
${range("photoX", "Move left or right", 0, 100, look.photoX ?? 0.5)}
${range("photoY", "Move up or down", 0, 100, look.photoY ?? 0.5)}
<h3>Show on the flyer</h3>
${tick("prices", "Prices", draft.prices)}${tick("logo", "Logo", draft.show.logo)}${tick("number", "WhatsApp number", draft.show.number)}${tick("link", "Shop page link", draft.show.link)}
<div class="actions"><button id="apply">Update the flyer</button><button class="ghost" name="reset" value="1">Back to the design's own look</button></div>
<p class="muted small"><a href="/home/flyers/${id}">See all designs side by side</a> · <a href="/home/flyers?from=${id}">Change the products or pictures</a></p>
</form>`;
  };

  app.post("/flyers/:draft/:design/use", async (c) => {
    const draft = draftOf(c);
    const design = c.req.param("design");
    const biz = c.get("biz");
    if (!draft || !isBusinessDesign(design)) return expired(c);
    const id = c.req.param("draft");
    if (biz.flyers && uncounted(draft, design)) {
      const status = await biz.flyers.status();
      if (locked(design, draft, status)) return c.redirect(`/home/flyers/${id}/${design}`, 303);
      const stop = await spend(c, draft, id, status);
      if (stop) return stop;
    }
    return c.redirect(`/home/flyers/${id}/${design}`, 303);
  });

  /** Saves the console's settings on the flyer. The page's script sends ?live=1 and just reloads the picture. */
  app.post("/flyers/:draft/:design/look", async (c) => {
    const draft = draftOf(c);
    const design = c.req.param("design");
    if (!draft || !isBusinessDesign(design)) return expired(c);
    const body = await c.req.parseBody();
    if (body.reset) {
      draft.look = {};
      draft.show = { logo: true, link: true, number: true };
    } else {
      // Counted plan and pack flyers keep their words: new words are a new flyer.
      if (!draft.pass || draft.pass === "open") {
        const headline = field(body, "headline", 40);
        if (headline) draft.headline = headline;
        draft.subline = field(body, "subline", 70);
      }
      const share = (name: string, low: number, high: number) => {
        const n = Number(field(body, name, 4));
        return Number.isFinite(n) && field(body, name, 4) !== "" ? Math.min(high, Math.max(low, n)) / 100 : undefined;
      };
      const font = field(body, "font", 20);
      draft.look = {
        font: isHeadlineFont(font) ? font : undefined,
        size: SIZES.find((x) => x.id === field(body, "size", 2))?.scale,
        zoom: share("zoom", 100, 200),
        photoX: share("photoX", 0, 100),
        photoY: share("photoY", 0, 100),
      };
      draft.colour = safeColour(field(body, "colour", 7) || draft.colour);
      draft.prices = Boolean(body.prices);
      draft.show = { logo: Boolean(body.logo), link: Boolean(body.link), number: Boolean(body.number) };
    }
    draft.version += 1;
    draft.made.clear();
    if (c.req.query("live")) return c.json({ version: draft.version });
    return c.redirect(`/home/flyers/${c.req.param("draft")}/${design}`, 303);
  });

  app.post("/flyers/:draft/:design/send", async (c) => {
    const denied = await ctx.ownerOnly(c);
    if (denied) return denied;
    const draft = draftOf(c);
    const design = c.req.param("design");
    const biz = c.get("biz");
    if (!draft || !isBusinessDesign(design) || !biz.sendFlyer) return expired(c);
    const back = `/home/flyers/${c.req.param("draft")}/${design}`;
    // Only a flyer that has been counted, on a design its pass covers, can go out.
    if (!draft.pass || (draft.pass === "plan" && !PLAN_DESIGNS.includes(design))) return c.redirect(back, 303);
    const message = field(await c.req.parseBody(), "message", MAX_MESSAGE);
    if (!message) return c.redirect(`${back}?msg=flyer_send_failed`, 303);
    try {
      const sent = await biz.sendFlyer.send(message, await flyer(biz, draft, design, draft.pass === "plan"), c.get("user").waId);
      return c.redirect(`${back}?msg=${sent.outcome === "queued" ? "flyer_sent" : sent.outcome === "limit_reached" ? "flyer_send_limit" : "flyer_send_nobody"}`, 303);
    } catch (err) {
      ctx.log.error("Owner app: sending a flyer to customers failed:", err);
      return c.redirect(`${back}?msg=flyer_send_failed`, 303);
    }
  });

  /** The finished flyer, drawn once for each design. */
  const flyer = async (biz: AppBusiness, draft: Draft, design: BusinessDesign, tag: boolean): Promise<Buffer> => {
    const key = `${design}|${tag}`;
    const made = draft.made.get(key) ?? (await make(biz, draft, design, tag));
    draft.made.set(key, made);
    return made;
  };

  const make = async (biz: AppBusiness, draft: Draft, design: BusinessDesign, tag: boolean): Promise<Buffer> => {
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
      logo: draft.show.logo ? (logo ?? undefined) : undefined,
      contact: draft.show.number && info?.whatsappNumber ? { label: words.order, number: flyerNumber(info.whatsappNumber) } : undefined,
      link: draft.show.link ? link?.replace(/^https?:\/\//, "") : undefined,
      fromWord: words.from,
      accent: draft.colour,
      look: draft.look,
      // Until migration 0082 gives Free its limit, Free is known by its plan code.
      credit: tag || (draft.pass === "open" && planCode === "free") ? "Made with yarnOga" : undefined,
    });
  };
}

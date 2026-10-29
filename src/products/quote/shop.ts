import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { html, raw } from "hono/html";
import { mark } from "../../core/brand.js";
import type { Lang } from "../../core/i18n.js";
import { formatMoney, type Currency } from "../../core/money.js";
import type { OutgoingImage } from "../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { priceFacts, priceText } from "./catalogue.js";
import type { Variant } from "./pricing.js";

// Each business's public shop page (QUOTE_SHOP, migration 0059), for an
// Instagram bio, a WhatsApp status or a flyer: <PUBLIC_URL>/shop/<name>.
//
// It lists the price list with prices worked out in code from the database,
// exactly as a quote would price them, plus product photos on plans with
// "catalogue". Customers pick quantities and tap one button: WhatsApp opens
// on the business's number with the order already typed ("I'd like to
// order: 100 x Flyers: A5 ..."), and the bot answers with a proper quote.
// Nothing is paid or saved on the page itself.
//
// The owner sends "shop" for the link and "shop link <name>" to change it.

export interface ShopOption {
  variant: Variant;
  /** The option part of "Product: option", e.g. "A5, double-sided". */
  label: string;
  /** Null when stock isn't counted. */
  stock: number | null;
}

export interface ShopProduct {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  /** A stored photo's path, or a sample photo's web address. */
  photoPath: string | null;
  leadTimeDays: number | null;
  options: ShopOption[];
}

export interface ShopBusiness {
  id: string;
  name: string;
  /** The number customers message, digits only. No number, no shop. */
  whatsappNumber: string | null;
  currency: Currency;
  lang: Lang;
  /** Whether the plan includes product photos ("catalogue"). */
  photos(): Promise<boolean>;
  products(): Promise<ShopProduct[]>;
  photo(path: string): Promise<OutgoingImage | null>;
  logo(): Promise<Uint8Array | null>;
}

export interface SlugStore {
  slugOf(businessId: string): Promise<string | null>;
  /** The active business with this shop name. */
  bySlug(slug: string): Promise<string | null>;
  /** False when another business already has it. */
  setSlug(businessId: string, slug: string): Promise<boolean>;
}

export interface ShopDeps {
  slugs: SlugStore;
  business(id: string): Promise<ShopBusiness | null>;
  publicUrl: string;
  log?: Pick<Console, "error">;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** "Mama Put's Kitchen!" -> "mama-puts-kitchen" */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ']/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : `${slug || "my"}-shop`;
}

export function createShopLinks(opts: { publicUrl: string; slugs: SlugStore }) {
  const url = (slug: string) => `${opts.publicUrl.replace(/\/+$/, "")}/shop/${slug}`;

  async function link(businessId: string, name: string): Promise<string> {
    const existing = await opts.slugs.slugOf(businessId);
    if (existing) return url(existing);
    const base = slugify(name);
    for (let n = 1; n <= 20; n++) {
      const slug = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
      if (await opts.slugs.setSlug(businessId, slug)) return url(slug);
    }
    throw new Error(`No free shop name for ${name}`);
  }

  async function rename(businessId: string, wanted: string): Promise<{ ok: true; link: string } | { ok: false; reason: "format" | "taken" }> {
    const slug = wanted.trim().toLowerCase().replace(/\s+/g, "-");
    if (!SLUG.test(slug) || slug.includes("--")) return { ok: false, reason: "format" };
    if ((await opts.slugs.slugOf(businessId)) === slug) return { ok: true, link: url(slug) };
    return (await opts.slugs.setSlug(businessId, slug)) ? { ok: true, link: url(slug) } : { ok: false, reason: "taken" };
  }

  return {
    link,
    rename,
    /** "shop" and "shop link <name>" from the owner; null for anything else. */
    async ownerCommand(b: { id: string; name: string; lang: Lang; hasNumber(): Promise<boolean> }, msg: IncomingMessage): Promise<string | null> {
      const text = (msg.text ?? "").trim();
      const fr = b.lang === "fr";
      const change = text.match(/^shop\s+(?:link|name)\s+(.+)$/i);
      if (change) {
        const result = await rename(b.id, change[1]!);
        if (result.ok) return fr ? `C'est fait. Votre boutique : ${result.link}\n\nL'ancien lien ne marche plus.` : `Done. Your shop is now ${result.link}\n\nThe old link no longer works.`;
        return result.reason === "taken"
          ? fr
            ? "Ce nom est déjà pris. Essayez-en un autre."
            : "Another business already has that name. Try a different one."
          : fr
            ? "Utilisez de 3 à 40 lettres minuscules, chiffres ou tirets, par exemple *shop link mama-put*."
            : "Use 3 to 40 lowercase letters, numbers or dashes, for example *shop link mama-put*.";
      }
      if (!/^(my )?(shop|store)( link)?$/i.test(text)) return null;
      const shop = await link(b.id, b.name);
      const lines = fr
        ? [
            `Votre boutique : ${shop}`,
            "",
            "Mettez ce lien dans votre bio Instagram, votre statut WhatsApp ou sur vos flyers. Les clients voient vos produits et vos prix, choisissent les quantités, et WhatsApp s'ouvre avec leur commande déjà écrite.",
            "",
            "Pour changer le nom du lien, envoyez *shop link* et le nom voulu, par exemple *shop link mama-put*.",
          ]
        : [
            `Your shop: ${shop}`,
            "",
            "Put it in your Instagram bio, on your WhatsApp status or on flyers. Customers see your products and prices, pick how many, and WhatsApp opens with their order already typed.",
            "",
            "To change the name in the link, send *shop link* and the name you want, e.g. *shop link mama-put*.",
          ];
      if (!(await b.hasNumber())) {
        lines.push(
          "",
          fr
            ? "⚠️ Ajoutez d'abord le numéro WhatsApp que vos clients écrivent dans les Paramètres de l'appli (envoyez *app*). Sans lui, la boutique reste fermée."
            : "⚠️ First add the WhatsApp number your customers message in Settings in your app (send *app*). Until then the shop stays closed.",
        );
      }
      return lines.join("\n");
    },
  };
}

const TEXT = {
  en: {
    notFound: "This shop link isn't right. Please check you have the whole link.",
    closed: (b: string) => `${b}'s shop isn't open yet. Please check back soon.`,
    empty: "There's nothing on the price list yet.",
    order: "Order on WhatsApp",
    soldOut: "Sold out",
    left: (n: number) => `${n} left`,
    onRequest: "Price on request",
    ready: (d: number) => (d === 0 ? "Ready the same day" : `Ready in ${d} working day${d === 1 ? "" : "s"}`),
    quantity: (o: string) => `How many: ${o}`,
    more: "More",
    picked: { one: "1 item picked", many: "{n} items picked" },
    send: "Send order on WhatsApp",
    note: "Pick how many you want, then send. Your exact total comes back on WhatsApp, with delivery and any discount.",
    intro: (b: string) => `Hello ${b}, I'd like to order:`,
    want: (p: string) => `I'd like ${p}`,
    chat: "Chat on WhatsApp",
    hello: (b: string) => `Hello ${b}`,
    footer: "Shop by",
  },
  fr: {
    notFound: "Ce lien de boutique n'est pas valide. Vérifiez que vous avez le lien en entier.",
    closed: (b: string) => `La boutique de ${b} n'est pas encore ouverte. Revenez bientôt.`,
    empty: "Il n'y a encore rien dans la liste de prix.",
    order: "Commander sur WhatsApp",
    soldOut: "Épuisé",
    left: (n: number) => `Plus que ${n}`,
    onRequest: "Prix sur demande",
    ready: (d: number) => (d === 0 ? "Prêt le jour même" : `Prêt en ${d} jour${d === 1 ? "" : "s"} ouvré${d === 1 ? "" : "s"}`),
    quantity: (o: string) => `Quantité : ${o}`,
    more: "Autres",
    picked: { one: "1 article choisi", many: "{n} articles choisis" },
    send: "Envoyer la commande sur WhatsApp",
    note: "Choisissez les quantités, puis envoyez. Le total exact vous revient sur WhatsApp, avec la livraison et les réductions.",
    intro: (b: string) => `Bonjour ${b}, je voudrais commander :`,
    want: (p: string) => `Je voudrais ${p}`,
    chat: "Discuter sur WhatsApp",
    hello: (b: string) => `Bonjour ${b}`,
    footer: "Boutique par",
  },
};

/** Counted stock at or below this shows "N left". */
const FEW_LEFT = 5;

export function createShopPage(deps: ShopDeps) {
  const app = new Hono();
  const log = deps.log ?? console;
  const base = deps.publicUrl.replace(/\/+$/, "");

  async function load(slug: string) {
    if (!SLUG.test(slug)) return null;
    const id = await deps.slugs.bySlug(slug);
    return id ? deps.business(id) : null;
  }

  app.get("/shop/:slug", async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    const b = await load(slug);
    if (!b) return c.html(shell("en", "Shop not found", html`<main><div class="card">${TEXT.en.notFound}</div></main>`), 404);
    const t = TEXT[b.lang];
    if (!b.whatsappNumber) return c.html(shell(b.lang, b.name, html`<main><div class="card">${t.closed(b.name)}</div></main>`));
    const [products, photos] = await Promise.all([b.products(), b.photos()]);
    const wa = (text: string) => `https://wa.me/${b.whatsappNumber}?text=${encodeURIComponent(text)}`;
    const money = (minor: number) => formatMoney(minor, b.currency);
    const photoUrl = (p: ShopProduct) =>
      !photos || !p.photoPath ? null : p.photoPath.startsWith("https://") ? p.photoPath : `/shop/${slug}/photo/${p.id}`;

    const card = (p: ShopProduct) => {
      const open = p.options.filter((o) => o.stock !== 0);
      const photo = photoUrl(p);
      return html`<article class="product">
  ${photo ? html`<img src="${photo}" alt="${p.name}" loading="lazy" width="640" height="480">` : ""}
  <div class="body">
    <h3>${p.name}</h3>
    ${p.description?.trim() ? html`<p class="desc">${p.description.trim()}</p>` : ""}
    ${p.leadTimeDays !== null ? html`<p class="muted">${t.ready(p.leadTimeDays)}</p>` : ""}
    <ul class="options">
      ${p.options.map((o) => {
        const facts = priceFacts(o.variant);
        const out = o.stock === 0;
        return html`<li${out ? raw(' class="out"') : ""}>
        <div><b>${capital(o.label) || p.name}</b><span>${facts ? priceText(facts, money, b.lang) : t.onRequest}</span>${
          out ? html`<em>${t.soldOut}</em>` : o.stock !== null && o.stock <= FEW_LEFT ? html`<em>${t.left(o.stock)}</em>` : ""
        }</div>
        ${out ? "" : html`<input class="qty" type="number" inputmode="numeric" min="0" step="1" placeholder="0" aria-label="${t.quantity(o.label || p.name)}" data-name="${o.variant.name}" data-min="${o.variant.minQuantity}">`}
      </li>`;
      })}
    </ul>
    ${open.length ? html`<a class="button" href="${wa(t.want(p.name))}">${t.order}</a>` : ""}
  </div>
</article>`;
    };

    // Grouped by category when the owner uses categories; the rest go last.
    const groups = new Map<string, ShopProduct[]>();
    for (const p of products) {
      const key = p.category?.trim() || "";
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    const named = [...groups.keys()].filter(Boolean).sort((a, z) => a.localeCompare(z));
    const sections = named.length
      ? [...named.map((k) => [k, groups.get(k)!] as const), ...(groups.has("") ? [[t.more, groups.get("")!] as const] : [])]
      : [["", products] as const];
    const firstPhoto = products.map(photoUrl).find(Boolean);

    const body = html`<header>
  <img class="logo" src="/shop/${slug}/logo" alt="" width="56" height="56" onerror="this.remove()">
  <div><h1>${b.name}</h1><a class="chat" href="${wa(t.hello(b.name))}">${t.chat}</a></div>
</header>
<main>
  ${products.length === 0 ? html`<div class="card">${t.empty}</div>` : html`<p class="muted">${t.note}</p>`}
  ${sections.map(([name, list]) => html`<section>${name ? html`<h2>${name}</h2>` : ""}<div class="grid">${list.map(card)}</div></section>`)}
</main>
<div class="bar" id="bar" hidden><span id="count"></span><a class="button" id="send" href="${wa(t.hello(b.name))}">${t.send}</a></div>
<script>
(() => {
  const intro = ${raw(JSON.stringify(t.intro(b.name)).replace(/</g, "\\u003c"))};
  const picked = ${raw(JSON.stringify(t.picked).replace(/</g, "\\u003c"))};
  const inputs = [...document.querySelectorAll("input.qty")];
  const bar = document.getElementById("bar");
  const send = document.getElementById("send");
  const update = () => {
    const lines = [];
    let items = 0;
    for (const input of inputs) {
      const n = Math.floor(Number(input.value));
      if (!(n > 0)) continue;
      items++;
      lines.push("• " + n + " x " + input.dataset.name);
    }
    bar.hidden = items === 0;
    document.body.classList.toggle("picking", items > 0);
    document.getElementById("count").textContent = items === 1 ? picked.one : picked.many.replace("{n}", String(items));
    send.href = "https://wa.me/${raw(b.whatsappNumber)}?text=" + encodeURIComponent([intro, ...lines].join("\\n"));
  };
  for (const input of inputs) {
    input.addEventListener("input", update);
    // Below the minimum, the first tap jumps to it.
    input.addEventListener("change", () => {
      const n = Math.floor(Number(input.value));
      const min = Number(input.dataset.min) || 1;
      if (n > 0 && n < min) input.value = String(min);
      update();
    });
  }
  document.documentElement.classList.add("js");
})();
</script>`;
    c.header("Cache-Control", "public, max-age=60");
    return c.html(
      shell(b.lang, b.name, body, {
        description: products.slice(0, 6).map((p) => p.name).join(" · "),
        image: firstPhoto ? (firstPhoto.startsWith("https://") ? firstPhoto : `${base}${firstPhoto}`) : null,
        url: `${base}/shop/${slug}`,
      }),
    );
  });

  app.get("/shop/:slug/photo/:productId", async (c) => {
    const productId = c.req.param("productId");
    if (!/^[0-9a-f-]{36}$/.test(productId)) return c.notFound();
    const b = await load(c.req.param("slug").toLowerCase());
    if (!b || !(await b.photos())) return c.notFound();
    try {
      const photo = await b.photo(`businesses/${b.id}/products/${productId}`);
      if (!photo) return c.notFound();
      return c.body(photo.data as unknown as ArrayBuffer, 200, { "Content-Type": photo.mimeType, "Cache-Control": "public, max-age=3600" });
    } catch (err) {
      log.error("Shop page: could not load a product photo:", err);
      return c.notFound();
    }
  });

  app.get("/shop/:slug/logo", async (c) => {
    const b = await load(c.req.param("slug").toLowerCase());
    const logo = b ? await b.logo().catch(() => null) : null;
    if (!logo) return c.notFound();
    return c.body(logo as unknown as ArrayBuffer, 200, { "Content-Type": imageType(logo), "Cache-Control": "public, max-age=3600" });
  });

  return app;
}

const capital = (text: string) => (text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : "");

function imageType(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50) return "image/png";
  if (data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57) return "image/webp";
  return "image/jpeg";
}

function shell(lang: Lang, title: string, body: unknown, meta: { description: string; image: string | null; url: string } | null = null) {
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${meta
  ? html`<meta name="description" content="${meta.description}">
<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${meta.description}"><meta property="og:url" content="${meta.url}">
${meta.image ? html`<meta property="og:image" content="${meta.image}">` : ""}`
  : html`<meta name="robots" content="noindex">`}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@700&family=Instrument+Sans:wght@400;600&family=Schibsted+Grotesk:wght@700&display=swap" rel="stylesheet">
<style>
  /* yarnOga's colours and type, as on yarnoga.com and the tracking page. */
  :root { --bg: #0a0d0b; --card: #0f1411; --line: rgba(243,241,230,.12); --text: #f3f1e6; --muted: rgba(243,241,230,.68);
    --lime: #c6ff1f; --limeink: #121400; --mint: #2ee5a0; --red: #ff8a7a; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text);
    background-image: radial-gradient(700px 400px at 90% -10%, rgba(198,255,31,.08), transparent 60%); min-height: 100vh; }
  body.picking { padding-bottom: 96px; }
  header { max-width: 960px; margin: 0 auto; padding: 24px 16px 8px; display: flex; gap: 14px; align-items: center; }
  header .logo { width: 56px; height: 56px; border-radius: 12px; object-fit: cover; background: #fff; flex: none; }
  header h1 { font: 700 1.7rem/1.15 "Chakra Petch", Arial, sans-serif; letter-spacing: -.01em; margin: 0 0 4px; }
  header .chat { font-size: 14px; font-weight: 600; }
  main { max-width: 960px; margin: 0 auto; padding: 8px 16px 16px; }
  h2 { font: 700 1.05rem/1.2 "Schibsted Grotesk", Arial, sans-serif; color: var(--mint); text-transform: uppercase; letter-spacing: .08em; margin: 24px 0 12px; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card, .product { background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
  .card { padding: 16px; }
  .product { overflow: hidden; display: flex; flex-direction: column; }
  .product img { width: 100%; aspect-ratio: 4 / 3; height: auto; object-fit: cover; display: block; background: #161c18; }
  .product .body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  .product h3 { font: 700 1.15rem/1.25 "Schibsted Grotesk", Arial, sans-serif; letter-spacing: -.01em; margin: 0; }
  .desc { margin: 0; font-size: 15px; white-space: pre-line; }
  .muted { color: var(--muted); font-size: 14px; margin: 0; }
  .options { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .options li { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--line); }
  .options li div { display: grid; font-size: 14px; }
  .options li span { color: var(--muted); }
  .options li em { font-style: normal; font-size: 12px; font-weight: 600; color: var(--lime); }
  .options li.out { opacity: .55; }
  .options li.out em { color: var(--red); }
  .qty { display: none; width: 76px; flex: none; padding: 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: 600 16px/1 "Instrument Sans", sans-serif; text-align: center; }
  .js .qty { display: block; }
  .qty:focus { outline: 2px solid var(--lime); outline-offset: 1px; }
  .button { display: block; text-align: center; text-decoration: none; margin-top: auto; font: 700 1rem/1.2 "Schibsted Grotesk", Arial, sans-serif; padding: 13px; border-radius: 6px;
    background: var(--lime); color: var(--limeink); box-shadow: 3px 3px 0 var(--mint); }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: rgba(15,20,17,.96);
    border-top: 1px solid var(--line); display: flex; gap: 12px; align-items: center; justify-content: space-between; }
  .bar[hidden] { display: none; }
  .bar span { font-weight: 600; font-size: 14px; white-space: nowrap; }
  /* While picking, the bar's button sends everything; one-product buttons would drop the rest. */
  .picking .product .button { display: none; }
  .bar .button { margin: 0; flex: 0 1 320px; }
  a { color: var(--lime); text-underline-offset: 3px; }
  footer { max-width: 960px; margin: 0 auto; padding: 8px 16px 32px; }
  footer a { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); text-decoration: none; font-size: 13px; }
  footer b { color: var(--text); font: 700 15px/1 "Schibsted Grotesk", Arial, sans-serif; letter-spacing: -.02em; }
  footer b span { color: var(--lime); }
</style>
</head>
<body>
${body}
<footer><a href="https://yarnoga.com">${raw(mark("ym", 22))}<span>${TEXT[lang].footer} <b>yarn<span>Oga</span></b></span></a></footer>
</body>
</html>`;
}

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  category?: string | null;
  photo_path?: string | null;
  lead_time_days?: number | null;
  quote_variants: Array<{
    id: string;
    name: string;
    min_quantity: number;
    active: boolean;
    stock?: number | null;
    quote_price_tiers: Array<{ min_quantity: number; unit_price_kobo: number | string }>;
  }>;
};

export function createSupabaseShopProducts(db: SupabaseClient, businessId: string): () => Promise<ShopProduct[]> {
  return async () => {
    const { data, error } = await db
      .from("quote_products")
      // Every column, so the shop works before and after the photo, stock and category migrations.
      .select("*, quote_variants(*, quote_price_tiers(min_quantity, unit_price_kobo))")
      .eq("business_id", businessId)
      .eq("active", true);
    if (error) throw new Error(`shop products failed: ${error.message}`);
    return ((data ?? []) as unknown as ProductRow[])
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category ?? null,
        photoPath: p.photo_path ?? null,
        leadTimeDays: p.lead_time_days ?? null,
        options: p.quote_variants
          .filter((v) => v.active)
          .map((v) => ({
            label: v.name,
            stock: v.stock ?? null,
            variant: {
              id: v.id,
              name: `${p.name}: ${v.name}`,
              minQuantity: v.min_quantity,
              tiers: v.quote_price_tiers.map((t) => ({ minQuantity: t.min_quantity, unitPriceKobo: Number(t.unit_price_kobo) })),
            },
          }))
          .sort((a, z) => a.label.localeCompare(z.label)),
      }))
      .filter((p) => p.options.length > 0)
      .sort((a, z) => a.name.localeCompare(z.name));
  };
}

export function createSupabaseSlugs(db: SupabaseClient): SlugStore {
  return {
    async slugOf(businessId) {
      const { data, error } = await db.from("quote_businesses").select("shop_slug").eq("id", businessId).maybeSingle();
      if (error) throw new Error(`shop name lookup failed: ${error.message}`);
      return (data?.shop_slug as string | null) ?? null;
    },
    async bySlug(slug) {
      const { data, error } = await db.from("quote_businesses").select("id, active").eq("shop_slug", slug).maybeSingle();
      if (error) throw new Error(`shop lookup failed: ${error.message}`);
      return data && data.active ? (data.id as string) : null;
    },
    async setSlug(businessId, slug) {
      const { error } = await db.from("quote_businesses").update({ shop_slug: slug }).eq("id", businessId);
      // 23505: another business has this name.
      if (error?.code === "23505") return false;
      if (error) throw new Error(`setting the shop name failed: ${error.message}`);
      return true;
    },
  };
}

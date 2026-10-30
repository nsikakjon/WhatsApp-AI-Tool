import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono, type Context } from "hono";
import { compress } from "hono/compress";
import { html, raw } from "hono/html";
import { mark } from "../../core/brand.js";
import type { Lang } from "../../core/i18n.js";
import { formatMoney, type Currency } from "../../core/money.js";
import type { OutgoingImage } from "../../core/whatsapp/client.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { cleanHours, nextOpenText, openState, type OpeningHours } from "./about.js";
import { priceFacts, priceText } from "./catalogue.js";
import type { Variant } from "./pricing.js";
import { pickWidth, previewCard, resized } from "./shop-images.js";

// Each business's public shop page (QUOTE_SHOP, migration 0059), for an
// Instagram bio, a WhatsApp status or a flyer: <PUBLIC_URL>/shop/<name>.
//
// It lists the price list with prices worked out in code from the database,
// exactly as a quote would price them, plus product photos on plans with
// "catalogue". The page wears the business's logo, cover photo and colour,
// says whether it's open now, and shows its ratings and delivery areas.
// Customers search or jump between categories, open a product full screen to
// swipe through its photos, and pick quantities with + and -, watching a
// running total. One button opens WhatsApp on the business's number with the
// order already typed ("I'd like to order: 100 x Flyers: A5 ..."), and the
// bot answers with a proper quote. Nothing is paid or saved on the page.
//
// It's built to load fast on 3G: no libraries, one small script, and photos
// resized on the server to the width the phone shows them at.
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
  /** Up to four more photos' paths (migration 0061), for the full-screen view. */
  morePhotos: string[];
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
  /** The owner's colour, "#e4572e" (migration 0061); null for yarnOga's lime. */
  accent: string | null;
  /** The cover photo's stored path (migration 0061). */
  coverPath: string | null;
  /** Opening hours (migration 0054), for "Open now". */
  hours: OpeningHours | null;
  /** Customers' ratings of their orders (migration 0054), out of 5. */
  ratings(): Promise<{ average: number; count: number } | null>;
  /** The delivery zones' names, when the business delivers (QUOTE_DELIVERY). */
  deliveryAreas(): Promise<string[]>;
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
  now?: () => Date;
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
    fewer: "One fewer",
    more1: "One more",
    more: "More",
    picked: { one: "1 item", many: "{n} items" },
    send: "Send order on WhatsApp",
    beforeDelivery: "before delivery",
    priced: "some prices confirmed on WhatsApp",
    note: "Pick how many you want, then send. Your exact total comes back on WhatsApp, with delivery and any discount.",
    intro: (b: string) => `Hello ${b}, I'd like to order:`,
    want: (p: string) => `I'd like ${p}`,
    chat: "Chat on WhatsApp",
    hello: (b: string) => `Hello ${b}`,
    openNow: (until: string) => `Open now · closes ${until}`,
    closedNow: (next: string | null) => (next ? `Closed · opens ${next}` : "Closed"),
    rated: (avg: string, n: number) => `${avg} from ${n} ratings`,
    delivers: (areas: string[], more: number) => `Delivers to ${areas.join(", ")}${more ? ` and ${more} more area${more === 1 ? "" : "s"}` : ""}`,
    find: "Search products",
    noMatch: "Nothing matches that. Ask on WhatsApp, they may still have it.",
    close: "Close",
    view: (p: string) => `See ${p}`,
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
    fewer: "Un de moins",
    more1: "Un de plus",
    more: "Autres",
    picked: { one: "1 article", many: "{n} articles" },
    send: "Envoyer la commande sur WhatsApp",
    beforeDelivery: "hors livraison",
    priced: "certains prix confirmés sur WhatsApp",
    note: "Choisissez les quantités, puis envoyez. Le total exact vous revient sur WhatsApp, avec la livraison et les réductions.",
    intro: (b: string) => `Bonjour ${b}, je voudrais commander :`,
    want: (p: string) => `Je voudrais ${p}`,
    chat: "Discuter sur WhatsApp",
    hello: (b: string) => `Bonjour ${b}`,
    openNow: (until: string) => `Ouvert · ferme à ${until}`,
    closedNow: (next: string | null) => (next ? `Fermé · ouvre ${next}` : "Fermé"),
    rated: (avg: string, n: number) => `${avg} sur ${n} avis`,
    delivers: (areas: string[], more: number) => `Livre à ${areas.join(", ")}${more ? ` et ${more} autre${more === 1 ? "" : "s"} zone${more === 1 ? "" : "s"}` : ""}`,
    find: "Chercher un produit",
    noMatch: "Rien ne correspond. Demandez sur WhatsApp, ils l'ont peut-être.",
    close: "Fermer",
    view: (p: string) => `Voir ${p}`,
    footer: "Boutique par",
  },
};

/** Counted stock at or below this shows "N left". */
const FEW_LEFT = 5;
/** Fewer ratings than this aren't shown: one happy customer isn't a track record. */
const MIN_RATINGS = 3;
const AREAS_SHOWN = 3;

const BG = "#0a0d0b";
const LIME = { accent: "#c6ff1f", ink: "#121400", hi: "#2ee5a0", shadow: "#2ee5a0" };

/**
 * The page's colours from the owner's accent: the accent itself on buttons,
 * with dark or white text, whichever reads better; headings in the accent
 * when it's light enough to read on the dark page, else in plain text.
 */
export function shopTheme(accent: string | null): typeof LIME {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return LIME;
  const a = accent.toLowerCase();
  const ink = contrast(a, LIME.ink) >= contrast(a, "#ffffff") ? LIME.ink : "#ffffff";
  const shade = `#${rgb(a).map((c) => Math.round(c * 0.55).toString(16).padStart(2, "0")).join("")}`;
  return { accent: a, ink, hi: contrast(a, BG) >= 4.5 ? a : "#f3f1e6", shadow: shade };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** The JSON a script on the page reads, safe inside a <script> tag. */
const json = (value: unknown) => raw(JSON.stringify(value).replace(/</g, "\\u003c"));

export function createShopPage(deps: ShopDeps) {
  const app = new Hono();
  const log = deps.log ?? console;
  const base = deps.publicUrl.replace(/\/+$/, "");
  const now = deps.now ?? (() => new Date());

  async function load(slug: string) {
    if (!SLUG.test(slug)) return null;
    const id = await deps.slugs.bySlug(slug);
    return id ? deps.business(id) : null;
  }

  // The page is mostly text: gzipped, it's about a third of the size over a slow connection.
  app.use("/shop/:slug", compress());

  app.get("/shop/:slug", async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    const b = await load(slug);
    if (!b) return c.html(shell("en", "Shop not found", html`<main><div class="card">${TEXT.en.notFound}</div></main>`), 404);
    // Pidgin is a chat language only (core/i18n.ts): a page is English or French.
    const lang = b.lang === "fr" ? "fr" : "en";
    const t = TEXT[lang];
    const theme = shopTheme(b.accent);
    if (!b.whatsappNumber) return c.html(shell(lang, b.name, html`<main><div class="card">${t.closed(b.name)}</div></main>`, null, theme));
    const [products, photos, ratings, areas] = await Promise.all([
      b.products(),
      b.photos(),
      b.ratings().catch((err) => (log.error("Shop page: ratings failed:", err), null)),
      b.deliveryAreas().catch((err) => (log.error("Shop page: delivery areas failed:", err), [] as string[])),
    ]);
    const wa = (text: string) => `https://wa.me/${b.whatsappNumber}?text=${encodeURIComponent(text)}`;
    const money = (minor: number) => formatMoney(minor, b.currency);
    const photoUrls = (p: ShopProduct) =>
      !photos || !p.photoPath ? [] : [`/shop/${slug}/photo/${p.id}`, ...p.morePhotos.map((_, i) => `/shop/${slug}/photo/${p.id}/${i + 1}`)];

    const stepper = (o: ShopOption, label: string) =>
      html`<div class="step" data-v="${o.variant.id}" data-name="${o.variant.name}" data-min="${o.variant.minQuantity}"${o.stock !== null ? html` data-max="${o.stock}"` : ""} data-tiers="${JSON.stringify(o.variant.tiers.map((x) => [x.minQuantity, x.unitPriceKobo]))}">
          <button type="button" class="minus" aria-label="${t.fewer}" disabled>−</button><input class="qty" type="number" inputmode="numeric" min="0" step="1" placeholder="0" aria-label="${t.quantity(label)}"><button type="button" class="plus" aria-label="${t.more1}">+</button>
        </div>`;

    const card = (p: ShopProduct) => {
      const open = p.options.filter((o) => o.stock !== 0);
      const urls = photoUrls(p);
      const find = [p.name, p.category, p.description, ...p.options.map((o) => o.label)].filter(Boolean).join(" ").toLowerCase();
      return html`<article class="product" id="p-${p.id}" data-find="${find}"${urls.length ? html` data-photos="${JSON.stringify(urls)}"` : ""}>
  ${urls.length
    ? html`<a class="photo" href="#p-${p.id}" data-open="${p.id}" aria-label="${t.view(p.name)}"><img src="${urls[0]}?w=360" srcset="${urls[0]}?w=360 360w, ${urls[0]}?w=720 720w" sizes="(min-width: 640px) 300px, 100vw" alt="${p.name}" loading="lazy" decoding="async" width="640" height="480">${
        urls.length > 1 ? html`<span class="count">1/${urls.length}</span>` : ""
      }</a>`
    : ""}
  <div class="body">
    <h3><a href="#p-${p.id}" data-open="${p.id}">${p.name}</a></h3>
    ${p.description?.trim() ? html`<p class="desc">${p.description.trim()}</p>` : ""}
    ${p.leadTimeDays !== null ? html`<p class="muted">${t.ready(p.leadTimeDays)}</p>` : ""}
    <ul class="options">
      ${p.options.map((o) => {
        const facts = priceFacts(o.variant);
        const out = o.stock === 0;
        return html`<li${out ? raw(' class="out"') : ""}>
        <div><b>${capital(o.label) || p.name}</b><span>${facts ? priceText(facts, money, lang) : t.onRequest}</span>${
          out ? html`<em>${t.soldOut}</em>` : o.stock !== null && o.stock <= FEW_LEFT ? html`<em>${t.left(o.stock)}</em>` : ""
        }</div>
        ${out ? "" : stepper(o, o.label || p.name)}
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
    const cover = Boolean(b.coverPath);

    const state = openState(b.hours, now());
    const status = state && (state.open ? t.openNow(state.closes) : t.closedNow(state.next ? nextOpenText(state.next, lang) : null));
    const stars = ratings && ratings.count >= MIN_RATINGS ? t.rated(ratings.average.toFixed(1).replace(".", lang === "fr" ? "," : "."), ratings.count) : null;
    const delivers = areas.length ? t.delivers(areas.slice(0, AREAS_SHOWN), Math.max(0, areas.length - AREAS_SHOWN)) : null;

    const body = html`<header class="top${cover ? " has-cover" : ""}">
  ${cover
    ? html`<img class="cover" src="/shop/${slug}/cover?w=720" srcset="/shop/${slug}/cover?w=720 720w, /shop/${slug}/cover?w=1080 1080w" sizes="100vw" alt="" fetchpriority="high" width="1080" height="400">`
    : ""}
  <div class="id">
    <img class="logo" src="/shop/${slug}/logo" alt="" width="64" height="64" onerror="this.remove()">
    <div>
      <h1>${b.name}</h1>
      ${status ? html`<p class="status${state!.open ? " open" : ""}">${status}</p>` : ""}
    </div>
  </div>
  ${stars || delivers
    ? html`<ul class="trust">${stars ? html`<li><span class="star" aria-hidden="true">★</span> ${stars}</li>` : ""}${delivers ? html`<li>${delivers}</li>` : ""}</ul>`
    : ""}
  <a class="chat" href="${wa(t.hello(b.name))}">${t.chat}</a>
</header>
${products.length > 0
  ? html`<nav class="tabs" aria-label="${lang === "fr" ? "Catégories" : "Categories"}">
  <input id="find" type="search" placeholder="${t.find}" aria-label="${t.find}" autocomplete="off">
  ${sections.length > 1 ? html`<div class="chips">${sections.map(([name], i) => html`<a href="#c${i}">${name}</a>`)}</div>` : ""}
</nav>`
  : ""}
<main>
  ${products.length === 0 ? html`<div class="card">${t.empty}</div>` : html`<p class="muted">${t.note}</p>`}
  ${sections.map(([name, list], i) => html`<section id="c${i}">${name ? html`<h2>${name}</h2>` : ""}<div class="grid">${list.map(card)}</div></section>`)}
  <p class="card" id="none" hidden>${t.noMatch} <a href="${wa(t.hello(b.name))}">${t.chat}</a></p>
</main>
<div class="view" id="view" role="dialog" aria-modal="true" aria-label="" hidden>
  <button type="button" class="shut" aria-label="${t.close}">✕</button>
  <div class="gallery"></div><div class="dots"></div>
  <div class="sheet"></div>
</div>
<div class="bar" id="bar" hidden><div><b id="total"></b><small><span id="count"></span> · <span id="sub"></span></small></div><a class="button" id="send" href="${wa(t.hello(b.name))}">${t.send}</a></div>
<script>
(() => {
  // The running total uses the price list's tiers exactly as pricing.ts does:
  // the best tier the quantity reaches, times the quantity. It's a guide for
  // the customer; the bot works out the real quote from the database.
  const T = ${json({ intro: t.intro(b.name), picked: t.picked, before: t.beforeDelivery, priced: t.priced, currency: b.currency, wa: b.whatsappNumber })};
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const info = new Map();
  for (const s of $$(".step")) {
    info.set(s.dataset.v, { name: s.dataset.name, min: Number(s.dataset.min) || 1, max: s.dataset.max === undefined ? Infinity : Number(s.dataset.max), tiers: JSON.parse(s.dataset.tiers) });
  }
  const qty = new Map();
  const bar = document.getElementById("bar");
  const count = document.getElementById("count"), total = document.getElementById("total");
  const group = (n, sep) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, sep);
  const money = (m) => {
    const whole = Math.floor(m / 100), rest = m % 100, cents = String(rest).padStart(2, "0");
    return T.currency === "NGN" ? "₦" + group(whole, ",") + (rest ? "." + cents : "") : group(whole, "\\u00a0") + (rest ? "," + cents : "") + " FCFA";
  };
  const unit = (i, n) => {
    let best = null;
    for (const [min, price] of i.tiers) if (n >= min && (!best || min > best[0])) best = [min, price];
    return best && best[1];
  };
  const totals = () => {
    const lines = [];
    let sum = 0, unpriced = false;
    for (const [v, n] of qty) {
      if (!(n > 0)) continue;
      const i = info.get(v), price = unit(i, n);
      lines.push("• " + n + " x " + i.name);
      if (price === null || n < i.min) unpriced = true;
      else sum += price * n;
    }
    bar.hidden = lines.length === 0;
    document.body.classList.toggle("picking", lines.length > 0);
    count.textContent = lines.length === 1 ? T.picked.one : T.picked.many.replace("{n}", String(lines.length));
    total.textContent = money(sum);
    document.getElementById("sub").textContent = T.before + (unpriced ? " · " + T.priced : "");
    document.getElementById("send").href = "https://wa.me/" + T.wa + "?text=" + encodeURIComponent([T.intro, ...lines].join("\\n"));
  };
  const show = (v) => {
    const n = qty.get(v) || 0, i = info.get(v);
    for (const s of $$('.step[data-v="' + v + '"]')) {
      s.classList.toggle("on", n > 0);
      s.querySelector("input").value = n ? String(n) : "";
      s.querySelector(".minus").disabled = n === 0;
      s.querySelector(".plus").disabled = n >= i.max;
    }
  };
  // Below the minimum, the first tap jumps to it, and taking one off goes back to none.
  const set = (v, n) => {
    const i = info.get(v);
    n = Math.max(0, Math.min(Math.floor(n) || 0, i.max));
    if (n > 0 && n < i.min) n = Math.min(i.min, i.max);
    qty.set(v, n);
    show(v);
    totals();
  };
  const bump = () => {
    total.classList.remove("bump");
    void total.offsetWidth;
    total.classList.add("bump");
  };
  const fly = (from) => {
    if (still.matches) return bump();
    const a = from.getBoundingClientRect(), z = total.getBoundingClientRect();
    const dot = document.createElement("i");
    dot.className = "fly";
    dot.style.left = a.left + a.width / 2 - 8 + "px";
    dot.style.top = a.top + a.height / 2 - 8 + "px";
    document.body.append(dot);
    const dx = z.left + 8 - a.left - a.width / 2, dy = z.top + z.height / 2 - a.top - a.height / 2;
    dot.animate([{ transform: "none" }, { transform: "translate(" + dx + "px," + dy + "px) scale(.4)", opacity: 0.5 }], { duration: 480, easing: "cubic-bezier(.4,-.4,.7,1)" }).onfinish = () => {
      dot.remove();
      bump();
    };
  };

  // The full-screen view: the product's photos to swipe through, and its options.
  const view = document.getElementById("view");
  const gallery = view.querySelector(".gallery"), dots = view.querySelector(".dots"), sheet = view.querySelector(".sheet");
  let pushed = false;
  const open = (id) => {
    const card = document.getElementById("p-" + id);
    if (!card) return false;
    const urls = JSON.parse(card.dataset.photos || "[]");
    gallery.replaceChildren(...urls.map((u, n) => {
      const img = new Image();
      img.src = u + "?w=720";
      img.srcset = u + "?w=720 720w, " + u + "?w=1080 1080w";
      img.sizes = "(min-width: 720px) 720px, 100vw";
      img.alt = "";
      if (n) img.loading = "lazy";
      return img;
    }));
    dots.replaceChildren(...(urls.length > 1 ? urls.map(() => document.createElement("i")) : []));
    dots.firstChild?.classList.add("on");
    gallery.scrollLeft = 0;
    sheet.replaceChildren(card.querySelector(".body").cloneNode(true));
    view.setAttribute("aria-label", card.querySelector("h3").textContent);
    view.classList.toggle("bare", urls.length === 0);
    view.hidden = false;
    document.body.classList.add("viewing");
    view.querySelector(".shut").focus({ preventScroll: true });
    return true;
  };
  const shut = () => {
    if (view.hidden) return;
    const done = () => {
      view.hidden = true;
      view.classList.remove("leaving");
      document.body.classList.remove("viewing");
    };
    if (still.matches) return done();
    view.classList.add("leaving");
    setTimeout(done, 200);
  };
  // The phone's back button closes the view rather than leaving the shop.
  const close = () => (pushed ? history.back() : shut());
  gallery.addEventListener("scroll", () => {
    const n = Math.round(gallery.scrollLeft / gallery.clientWidth);
    $$("i", dots).forEach((d, i) => d.classList.toggle("on", i === n));
  }, { passive: true });
  addEventListener("popstate", () => {
    pushed = false;
    if (location.hash.startsWith("#p-")) open(location.hash.slice(3));
    else shut();
  });
  addEventListener("keydown", (e) => e.key === "Escape" && close());

  document.addEventListener("click", (e) => {
    const step = e.target.closest(".step button");
    if (step) {
      const v = step.parentElement.dataset.v, i = info.get(v), n = qty.get(v) || 0;
      if (step.classList.contains("plus")) {
        set(v, n < i.min ? i.min : n + 1);
        fly(step);
      } else set(v, n - 1 < i.min ? 0 : n - 1);
      return;
    }
    const link = e.target.closest("[data-open]");
    if (link && !view.contains(link) && open(link.dataset.open)) {
      e.preventDefault();
      history.pushState({ view: link.dataset.open }, "", "#p-" + link.dataset.open);
      pushed = true;
      return;
    }
    if (e.target.closest(".shut")) close();
  });
  document.addEventListener("input", (e) => {
    const s = e.target.closest(".step");
    if (!s) return;
    qty.set(s.dataset.v, Math.max(0, Math.floor(Number(e.target.value)) || 0));
    totals();
  });
  document.addEventListener("change", (e) => {
    const s = e.target.closest(".step");
    if (s) set(s.dataset.v, Number(e.target.value));
  });

  const find = document.getElementById("find");
  find?.addEventListener("input", () => {
    const q = find.value.trim().toLowerCase();
    let shown = 0;
    for (const a of $$("article.product")) {
      a.hidden = Boolean(q) && !a.dataset.find.includes(q);
      if (!a.hidden) shown++;
    }
    for (const s of $$("main section")) s.hidden = !s.querySelector("article:not([hidden])");
    document.getElementById("none").hidden = shown > 0;
  });
  // The category tab for the part of the list on screen.
  const chips = document.querySelector(".chips");
  if (chips && "IntersectionObserver" in window) {
    const seen = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        for (const a of $$("a", chips)) a.toggleAttribute("aria-current", a.hash === "#" + en.target.id);
        const on = chips.querySelector("[aria-current]");
        if (on) chips.scrollTo({ left: on.offsetLeft - 16, behavior: still.matches ? "auto" : "smooth" });
      }
    }, { rootMargin: "-40% 0px -55% 0px" });
    $$("main section").forEach((s) => seen.observe(s));
  }
  document.documentElement.classList.add("js");
  if (location.hash.startsWith("#p-")) open(location.hash.slice(3));
})();
</script>`;
    c.header("Cache-Control", "public, max-age=60");
    return c.html(
      shell(
        lang,
        b.name,
        body,
        {
          // No "Open now" here: apps keep a shared link's preview for days.
          description: [...products.slice(0, 6).map((p) => p.name), t.order].join(" · "),
          image: `${base}/shop/${slug}/preview.jpg`,
          url: `${base}/shop/${slug}`,
        },
        theme,
      ),
    );
  });

  const imageHeaders = (data: Buffer | Uint8Array, type: string) =>
    ({ "Content-Type": type, "Content-Length": String(data.byteLength), "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" }) as const;

  /** A stored photo at the width the page asks for; the original if it can't be read as a picture. */
  async function sized(c: Context, key: string, find: () => Promise<OutgoingImage | null>) {
    let original: OutgoingImage | null = null;
    try {
      const data = await resized(key, pickWidth(c.req.query("w")), async () => {
        original = await find();
        return original?.data ?? null;
      });
      if (data) return c.body(data as unknown as ArrayBuffer, 200, imageHeaders(data, "image/webp"));
    } catch (err) {
      const o = original as OutgoingImage | null;
      if (o) return c.body(o.data as unknown as ArrayBuffer, 200, imageHeaders(o.data, o.mimeType));
      log.error("Shop page: could not load a photo:", err);
    }
    return c.notFound();
  }

  // Product photos: /photo/<id> is the main one, /photo/<id>/1 to /4 the extra ones.
  app.get("/shop/:slug/photo/:productId/:n?", async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    const productId = c.req.param("productId");
    const n = Number(c.req.param("n") ?? 0);
    if (!/^[0-9a-f-]{36}$/.test(productId) || !Number.isInteger(n) || n < 0 || n > 4) return c.notFound();
    return sized(c, `${slug}/${productId}/${n}`, async () => {
      const b = await load(slug);
      if (!b || !(await b.photos())) return null;
      const p = (await b.products()).find((x) => x.id === productId);
      const path = n === 0 ? p?.photoPath : p?.morePhotos[n - 1];
      return path ? b.photo(path) : null;
    });
  });

  app.get("/shop/:slug/cover", async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    return sized(c, `${slug}/cover`, async () => {
      const b = await load(slug);
      return b?.coverPath ? b.photo(b.coverPath) : null;
    });
  });

  app.get("/shop/:slug/logo", async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    return sized(c, `${slug}/logo`, async () => {
      const b = await load(slug);
      const logo = b ? await b.logo().catch(() => null) : null;
      return logo && { data: logo, mimeType: imageType(logo) };
    });
  });

  // The picture shown when the link is shared on WhatsApp, Instagram or Facebook.
  app.get("/shop/:slug/preview.jpg", async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    try {
      const b = await load(slug);
      if (!b) return c.notFound();
      const theme = shopTheme(b.accent);
      const first = async () => {
        if (b.coverPath) return b.photo(b.coverPath);
        if (!(await b.photos())) return null;
        const p = (await b.products()).find((x) => x.photoPath);
        return p ? b.photo(p.photoPath!) : null;
      };
      const [photo, logo] = await Promise.all([first(), b.logo().catch(() => null)]);
      const data = await previewCard(slug, { photo: photo?.data ?? null, logo, name: b.name, accent: b.accent ? theme.accent : BG, ink: b.accent ? theme.ink : "#f3f1e6" });
      if (!data) return c.notFound();
      return c.body(data as unknown as ArrayBuffer, 200, imageHeaders(data, "image/jpeg"));
    } catch (err) {
      log.error("Shop page: could not make the link preview:", err);
      return c.notFound();
    }
  });

  return app;
}

const capital = (text: string) => (text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : "");

function imageType(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50) return "image/png";
  if (data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57) return "image/webp";
  return "image/jpeg";
}

function shell(
  lang: keyof typeof TEXT,
  title: string,
  body: unknown,
  meta: { description: string; image: string; url: string } | null = null,
  theme: ReturnType<typeof shopTheme> = LIME,
) {
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="theme-color" content="${BG}">
${meta
  ? html`<meta name="description" content="${meta.description}">
<meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${meta.description}"><meta property="og:url" content="${meta.url}">
<meta property="og:image" content="${meta.image}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">`
  : html`<meta name="robots" content="noindex">`}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@700&family=Instrument+Sans:wght@400;600&family=Schibsted+Grotesk:wght@700&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<style>
  /* yarnOga's colours and type, as on yarnoga.com and the tracking page; buttons and headings take the shop's own colour. */
  :root { --bg: ${BG}; --card: #0f1411; --line: rgba(243,241,230,.12); --text: #f3f1e6; --muted: rgba(243,241,230,.68); --red: #ff8a7a;
    --accent: ${theme.accent}; --ink: ${theme.ink}; --hi: ${theme.hi}; --shadow: ${theme.shadow}; --ease: cubic-bezier(.2,.8,.2,1); }
  * { box-sizing: border-box; }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
  body { margin: 0; font: 16px/1.5 "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  body.picking { padding-bottom: 104px; }
  body.viewing { overflow: hidden; }
  a { color: var(--hi); text-underline-offset: 3px; }
  .top { position: relative; max-width: 960px; margin: 0 auto; padding: 24px 16px 12px; }
  .top.has-cover { padding-top: 0; }
  .cover { display: block; width: calc(100% + 32px); margin: 0 -16px; height: 180px; object-fit: cover; background: #161c18; }
  .id { display: flex; gap: 14px; align-items: flex-start; }
  .has-cover .id { padding-top: 10px; }
  .has-cover .logo { margin-top: -42px; position: relative; }
  .logo { width: 64px; height: 64px; border-radius: 14px; object-fit: contain; background: #fff; flex: none; border: 3px solid var(--bg); }
  h1 { font: 700 1.75rem/1.15 "Chakra Petch", Arial, sans-serif; letter-spacing: -.01em; margin: 0; }
  .status { margin: 4px 0 0; font-size: 14px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  .status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
  .status.open { color: var(--text); }
  .status.open::before { background: #2ee5a0; box-shadow: 0 0 0 3px rgba(46,229,160,.2); }
  .trust { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 14px; color: var(--muted); }
  .star { color: #ffc93c; }
  .chat { display: inline-block; margin-top: 10px; font-size: 14px; font-weight: 600; }
  .tabs { position: sticky; top: 0; z-index: 5; background: rgba(10,13,11,.94); border-bottom: 1px solid var(--line); }
  .tabs > * { max-width: 960px; margin-left: auto; margin-right: auto; }
  #find { display: none; width: calc(100% - 32px); margin: 10px 16px 8px; padding: 10px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: 16px "Instrument Sans", sans-serif; }
  .js #find { display: block; }
  @media (min-width: 992px) { #find { width: 928px; margin-left: auto; margin-right: auto; } }
  #find:focus, .qty:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px 16px 10px; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chips a { flex: none; padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line); color: var(--text); text-decoration: none; font-size: 14px; font-weight: 600; transition: background .2s, color .2s; }
  .chips a[aria-current] { background: var(--accent); color: var(--ink); border-color: var(--accent); }
  main { max-width: 960px; margin: 0 auto; padding: 8px 16px 16px; }
  section { scroll-margin-top: 112px; }
  section[hidden], .product[hidden] { display: none; }
  h2 { font: 700 1.05rem/1.2 "Schibsted Grotesk", Arial, sans-serif; color: var(--hi); text-transform: uppercase; letter-spacing: .08em; margin: 24px 0 12px; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .card, .product { background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
  .card { padding: 16px; }
  .product { overflow: hidden; display: flex; flex-direction: column; }
  .photo { position: relative; display: block; }
  .photo img { width: 100%; aspect-ratio: 4 / 3; height: auto; object-fit: cover; display: block; background: #161c18; }
  .photo .count { position: absolute; right: 10px; bottom: 10px; padding: 2px 8px; border-radius: 999px; background: rgba(10,13,11,.75); color: var(--text); font-size: 12px; font-weight: 600; }
  .body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
  h3 { font: 700 1.15rem/1.25 "Schibsted Grotesk", Arial, sans-serif; letter-spacing: -.01em; margin: 0; }
  h3 a { color: inherit; text-decoration: none; }
  .desc { margin: 0; font-size: 15px; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .muted { color: var(--muted); font-size: 14px; margin: 0; }
  .options { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .options li { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--line); }
  .options li div:first-child { display: grid; font-size: 14px; }
  .options li span { color: var(--muted); }
  .options li em { font-style: normal; font-size: 12px; font-weight: 600; color: var(--hi); }
  .options li.out { opacity: .55; }
  .options li.out em { color: var(--red); }
  .step { display: none; flex: none; align-items: center; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); transition: border-color .2s; }
  .js .step { display: flex; }
  .step.on { border-color: var(--accent); }
  .step button { width: 40px; height: 40px; border: 0; border-radius: 50%; background: none; color: var(--text); font: 600 20px/1 "Instrument Sans", sans-serif; cursor: pointer; touch-action: manipulation; }
  .step .plus { background: var(--accent); color: var(--ink); }
  .step button:disabled { opacity: .35; cursor: default; }
  .qty { width: 44px; padding: 8px 0; border: 0; background: none; color: var(--text); font: 600 16px/1 "Instrument Sans", sans-serif; text-align: center; -moz-appearance: textfield; }
  .qty::-webkit-inner-spin-button, .qty::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .button { display: block; text-align: center; text-decoration: none; margin-top: auto; font: 700 1rem/1.2 "Schibsted Grotesk", Arial, sans-serif; padding: 13px; border-radius: 8px;
    background: var(--accent); color: var(--ink); box-shadow: 3px 3px 0 var(--shadow); }
  .bar { position: fixed; z-index: 30; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: rgba(15,20,17,.97);
    border-top: 1px solid var(--line); display: flex; gap: 12px; align-items: center; justify-content: space-between; }
  .bar[hidden] { display: none; }
  .bar > div { font-size: 18px; line-height: 1.25; white-space: nowrap; }
  .bar small { display: block; color: var(--muted); font-size: 12px; }
  #total { display: inline-block; }
  /* While picking, the bar's button sends everything; one-product buttons would drop the rest. */
  .picking .product .button, .picking .sheet .button { display: none; }
  .bar .button { margin: 0; flex: 0 1 300px; }
  .fly { position: fixed; z-index: 40; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); pointer-events: none; }
  .view { position: fixed; z-index: 20; inset: 0; overflow-y: auto; background: var(--bg); overscroll-behavior: contain; }
  .view[hidden] { display: none; }
  .view > * { max-width: 720px; margin-left: auto; margin-right: auto; }
  .gallery { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; background: #161c18; }
  .gallery::-webkit-scrollbar { display: none; }
  .gallery img { flex: none; width: 100%; aspect-ratio: 1; object-fit: cover; scroll-snap-align: center; }
  .bare .gallery { display: none; }
  .dots { display: flex; justify-content: center; gap: 6px; padding: 10px 0 0; }
  .dots i { width: 6px; height: 6px; border-radius: 3px; background: var(--line); transition: width .25s var(--ease), background .25s; }
  .dots i.on { width: 18px; background: var(--accent); }
  .sheet .body { padding: 16px 16px 120px; }
  .sheet .desc { -webkit-line-clamp: unset; display: block; }
  .sheet h3 { font-size: 1.5rem; padding-right: 48px; }
  .sheet h3 a { pointer-events: none; }
  .bare .sheet h3 { margin-top: 56px; }
  .shut { position: fixed; z-index: 21; top: 12px; right: 12px; margin: 0; width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(10,13,11,.8); color: var(--text); font-size: 18px; cursor: pointer; }
  @media (min-width: 752px) { .shut { right: calc(50% - 348px); } }
  @media (prefers-reduced-motion: no-preference) {
    .view:not([hidden]) { animation: rise .32s var(--ease); }
    .view.leaving { animation: sink .2s ease-in forwards; }
    .bar:not([hidden]) { animation: rise .3s var(--ease); }
    #total.bump { animation: bump .3s var(--ease); }
    .product { transition: transform .15s; }
    .product:active { transform: scale(.99); }
  }
  @keyframes rise { from { transform: translateY(24px); opacity: 0; } }
  @keyframes sink { to { transform: translateY(24px); opacity: 0; } }
  @keyframes bump { 50% { transform: scale(1.18); } }
  footer { max-width: 960px; margin: 0 auto; padding: 8px 16px 32px; }
  footer a { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); text-decoration: none; font-size: 13px; }
  footer b { color: var(--text); font: 700 15px/1 "Schibsted Grotesk", Arial, sans-serif; letter-spacing: -.02em; }
  footer b span { color: #c6ff1f; }
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
  more_photos?: string[] | null;
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
        morePhotos: p.photo_path ? (p.more_photos ?? []) : [],
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

/** The business row's shop details. Every column, so it works before and after migrations 0054 and 0061. */
export async function supabaseShopLook(db: SupabaseClient, businessId: string) {
  const { data, error } = await db.from("quote_businesses").select("*").eq("id", businessId).maybeSingle();
  if (error) throw new Error(`shop details failed: ${error.message}`);
  return {
    whatsappNumber: (data?.whatsapp_number as string | null) ?? null,
    accent: (data?.shop_accent as string | null) ?? null,
    coverPath: (data?.shop_cover_path as string | null) ?? null,
    hours: cleanHours(data?.opening_hours),
    /** Owners who switch ratings off in the app don't show them on the shop either. */
    ratingsOn: data?.ratings_on !== false,
  };
}

export function createSupabaseShopRatings(db: SupabaseClient, businessId: string): ShopBusiness["ratings"] {
  return async () => {
    const { data, error } = await db.from("quote_orders").select("rating").eq("business_id", businessId).not("rating", "is", null).limit(5000);
    if (error) throw new Error(`shop ratings failed: ${error.message}`);
    const stars = (data ?? []).map((r) => Number(r.rating));
    return stars.length ? { average: stars.reduce((a, b) => a + b, 0) / stars.length, count: stars.length } : null;
  };
}

export function createSupabaseShopAreas(db: SupabaseClient, businessId: string): ShopBusiness["deliveryAreas"] {
  return async () => {
    const { data, error } = await db.from("quote_delivery_zones").select("name").eq("business_id", businessId).eq("active", true).order("fee_kobo");
    if (error) throw new Error(`shop delivery areas failed: ${error.message}`);
    return (data ?? []).map((z) => String(z.name));
  };
}

/** The owner app's side of the shop's look: its colour and cover photo (migration 0061). */
export interface ShopLookStore {
  get(businessId: string): Promise<{ accent: string | null; cover: boolean }>;
  /** Null goes back to yarnOga's colours. */
  setAccent(businessId: string, accent: string | null): Promise<void>;
  saveCover(businessId: string, data: Uint8Array, mimeType: string): Promise<void>;
  removeCover(businessId: string): Promise<void>;
}

export function createSupabaseShopLookStore(db: SupabaseClient): ShopLookStore {
  const update = async (businessId: string, row: Record<string, unknown>) => {
    const { error } = await db.from("quote_businesses").update(row).eq("id", businessId);
    if (error) throw new Error(`saving the shop's look failed: ${error.message}`);
  };
  return {
    async get(businessId) {
      const look = await supabaseShopLook(db, businessId);
      return { accent: look.accent, cover: Boolean(look.coverPath) };
    },
    setAccent: (businessId, accent) => update(businessId, { shop_accent: accent }),
    async saveCover(businessId, data, mimeType) {
      const path = `businesses/${businessId}/shop-cover`;
      const { error } = await db.storage.from("quote-files").upload(path, data, { contentType: mimeType, upsert: true });
      if (error) throw new Error(`saving the cover photo failed: ${error.message}`);
      await update(businessId, { shop_cover_path: path });
    },
    removeCover: (businessId) => update(businessId, { shop_cover_path: null }),
  };
}

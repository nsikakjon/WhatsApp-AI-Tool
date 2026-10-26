import type { Hono } from "hono";
import { formatNaira } from "../../core/money.js";
import { nairaToKobo } from "../../products/quote/pricelist.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import { DuplicateProductError, type ProductInput, type ProductOption, type ProductRecord } from "../store.js";
import type { AppContext, Env } from "../types.js";

// The price list, one product at a time: photo, name, description, category,
// unit, production time, and its options, each with a minimum order, stock
// and prices that can drop as the quantity goes up. Prices are typed in naira
// and saved in kobo; the bot quotes from exactly these numbers.

const UUID = /^[0-9a-f-]{36}$/;
const MAX_OPTIONS = 20;
const TIERS = 3;
const MAX_PHOTO = 5 * 1024 * 1024;

export interface PriceForm {
  input: ProductInput;
  problems: string[];
}

/** Reads the product form. Prices go through nairaToKobo, so "₦1,500" and "1500.50" work and "15k" doesn't. */
export function readProductForm(form: Record<string, unknown>): PriceForm {
  const problems: string[] = [];
  const name = field(form, "name", 80);
  if (!name) problems.push("Give the product a name.");
  const leadText = field(form, "lead", 4);
  const lead = leadText === "" ? null : Number(leadText);
  if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 365)) problems.push("Production time must be a whole number of days, 0 to 365.");

  const options: ProductOption[] = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const optName = field(form, `o${i}_name`, 80);
    const minText = field(form, `o${i}_min`, 9);
    const stockText = field(form, `o${i}_stock`, 9);
    const tiersText = Array.from({ length: TIERS }, (_, j) => [field(form, `o${i}_f${j}`, 9), field(form, `o${i}_p${j}`, 20)] as const);
    const blank = !optName && !minText && !stockText && tiersText.every(([f, p]) => !f && !p);
    if (blank) continue;
    const label = optName || `Option ${i + 1}`;
    if (!optName) problems.push(`${label}: give it a name, e.g. "Standard" or "A5, both sides".`);
    const min = minText === "" ? 1 : Number(minText.replace(/,/g, ""));
    if (!Number.isInteger(min) || min < 1) problems.push(`${label}: the minimum order must be a whole number, 1 or more.`);
    const stock = stockText === "" ? null : Number(stockText.replace(/,/g, ""));
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) problems.push(`${label}: stock must be a whole number, or left empty if you don't count it.`);
    const tiers: ProductOption["tiers"] = [];
    tiersText.forEach(([fromText, priceText], j) => {
      if (!priceText && !fromText) return;
      const price = nairaToKobo(priceText);
      if (price === null) {
        problems.push(`${label}: "${priceText || "(empty)"}" isn't a price. Type it in naira, e.g. 1500 or 1,500.50.`);
        return;
      }
      const from = fromText === "" ? (j === 0 ? min : NaN) : Number(fromText.replace(/,/g, ""));
      if (!Number.isInteger(from) || from < 1) {
        problems.push(`${label}: say from what quantity ${formatNaira(price)} applies.`);
        return;
      }
      tiers.push({ minQuantity: from, unitPriceKobo: price });
    });
    tiers.sort((a, b) => a.minQuantity - b.minQuantity);
    if (new Set(tiers.map((t) => t.minQuantity)).size !== tiers.length) problems.push(`${label}: two prices start at the same quantity.`);
    if (tiers.length && Number.isInteger(min) && tiers[0]!.minQuantity > min) {
      problems.push(`${label}: the first price must start at the minimum order (${min}) or lower, so every allowed quantity has a price.`);
    }
    const id = field(form, `o${i}_id`, 36);
    options.push({ ...(UUID.test(id) ? { id } : {}), name: optName, minQuantity: min, stock, tiers });
  }
  if (!options.length) problems.push("Add at least one option with a price (call it \"Standard\" if there's only one).");
  const names = options.map((o) => o.name.toLowerCase());
  if (new Set(names).size !== names.length) problems.push("Two options have the same name.");

  return {
    input: {
      name,
      description: field(form, "description", 600) || null,
      category: field(form, "category", 40) || null,
      unit: field(form, "unit", 30) || null,
      leadTimeDays: lead !== null && Number.isInteger(lead) ? lead : null,
      active: true,
      options,
    },
    problems,
  };
}

/** True when the bytes really are a JPEG or PNG (not just named like one). */
export function isPhoto(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

export function registerPrices(app: Hono<Env>, ctx: SectionContext) {
  app.get("/prices", async (c) => {
    const biz = c.get("biz");
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 60);
    const products = (await biz.prices.products()).filter(
      (p) => !q || p.name.toLowerCase().includes(q) || (p.category ?? "").toLowerCase().includes(q),
    );
    const cards = products
      .map((p) => {
        const from = p.options.flatMap((o) => o.tiers.map((t) => t.unitPriceKobo));
        const price = from.length ? `from ${formatNaira(Math.min(...from))}${p.unit ? ` per ${esc(p.unit)}` : ""}` : "priced by the team";
        const min = Math.min(...p.options.map((o) => o.minQuantity));
        const stockLow = p.options.some((o) => o.stock !== null && o.stock <= 5);
        const photo = p.photoPath && biz.photos ? `<img class="thumb" src="/app/prices/${p.id}/photo" alt="" loading="lazy">` : `<div class="thumb"></div>`;
        return `<a class="card" href="/app/prices/${p.id}" style="display:flex;gap:12px;text-decoration:none;color:inherit">${photo}<div><b>${esc(p.name)}</b>
${p.category ? `<span class="tag">${esc(p.category)}</span>` : ""}${stockLow ? ' <span class="tag red">low stock</span>' : ""}
<p class="muted small" style="margin:4px 0 0">${p.options.length} option${p.options.length === 1 ? "" : "s"} · ${price} · min ${min}</p></div></a>`;
      })
      .join("");
    return ctx.render(
      c,
      "Price list",
      "/app/prices",
      `<div class="row" style="margin-bottom:12px"><form method="get" class="row" style="flex:3"><input name="q" value="${esc(q)}" placeholder="Search products" aria-label="Search products"><button class="ghost">Search</button></form>
<a class="button" href="/app/prices/new" style="flex:0 0 auto">+ Add a product</a></div>
<div class="cards">${cards || `<p class="muted">No products yet. <a href="/app/prices/new">Add your first one</a>.</p>`}</div>
<p class="muted small">The bot quotes from this list only: the AI never sets a price. Changes reach customers straight away.</p>`,
    );
  });

  const formPage = (c: AppContext, product: ProductRecord | null, input: ProductInput | null, problems: string[], extra: number) => {
    const biz = c.get("biz");
    const p = input ?? product;
    const options = p?.options ?? [];
    const slots = Math.min(MAX_OPTIONS, Math.max(options.length + extra, 1));
    const v = (x: unknown) => esc(x === null || x === undefined ? "" : String(x));
    const optionRows = Array.from({ length: slots }, (_, i) => {
      const o = options[i];
      const tiers = Array.from({ length: TIERS }, (_, j) => {
        const t = o?.tiers[j];
        return `<tr><td><input name="o${i}_f${j}" inputmode="numeric" value="${v(t?.minQuantity)}" placeholder="${j === 0 ? "min" : ""}" aria-label="From quantity"></td>
<td><input name="o${i}_p${j}" inputmode="decimal" value="${t ? v((t.unitPriceKobo / 100).toFixed(2).replace(/\.00$/, "")) : ""}" placeholder="₦" aria-label="Price each in naira"></td></tr>`;
      }).join("");
      return `<fieldset class="card" style="margin:10px 0"><legend class="muted small">Option ${i + 1}</legend>
${o?.id ? `<input type="hidden" name="o${i}_id" value="${o.id}">` : ""}
<label>Name <span class="muted">e.g. "A5, both sides", "Large", "Standard"</span><input name="o${i}_name" value="${v(o?.name ?? (i === 0 && !product ? "Standard" : ""))}"></label>
<div class="row"><label>Minimum order<input name="o${i}_min" inputmode="numeric" value="${v(o?.minQuantity ?? "")}" placeholder="1"></label>
<label>In stock <span class="muted">(empty: not counted)</span><input name="o${i}_stock" inputmode="numeric" value="${v(o?.stock)}"></label></div>
<p style="margin:12px 0 4px"><b>Price each</b> <span class="muted small">Cheaper for bigger orders? Add a second price from a higher quantity.</span></p>
<table class="tiers"><tr><th>From quantity</th><th>Price each (₦)</th></tr>${tiers}</table></fieldset>`;
    }).join("");
    const action = product ? `/app/prices/${product.id}` : "/app/prices/new";
    const photo =
      biz.photos
        ? `<label>Photo <span class="muted">(JPEG or PNG, up to 5 MB; customers see it on product cards)</span>
${product?.photoPath ? `<img class="thumb" src="/app/prices/${product.id}/photo" alt="Current photo" style="width:120px;height:120px;display:block;margin:6px 0">` : ""}
<input type="file" name="photo" accept="image/jpeg,image/png"></label>`
        : "";
    return ctx.render(
      c,
      product ? product.name : "Add a product",
      "/app/prices",
      `${problems.length ? `<div class="flash bad"><p><b>Please fix:</b></p><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
<form method="post" action="${action}" enctype="multipart/form-data">
<label for="n">Product name</label><input id="n" name="name" required maxlength="80" value="${v(p?.name)}" placeholder="e.g. Flyers">
<label for="d">Description <span class="muted">(what it is, sizes, materials; helps customers and the AI)</span></label><textarea id="d" name="description" maxlength="600">${v(p?.description)}</textarea>
<div class="row"><label>Category <span class="muted">(optional)</span><input name="category" maxlength="40" value="${v(p?.category)}" placeholder="e.g. Printing"></label>
<label>Sold per <span class="muted">(optional)</span><input name="unit" maxlength="30" value="${v(p?.unit)}" placeholder="e.g. piece, pack of 100"></label>
<label>Production time <span class="muted">(days)</span><input name="lead" inputmode="numeric" value="${v(p?.leadTimeDays)}" placeholder="e.g. 2"></label></div>
${photo}
<h2>Options and prices</h2>${optionRows}
<div class="actions"><button>Save</button>${slots < MAX_OPTIONS ? `<a class="button ghost" href="${product ? `/app/prices/${product.id}` : "/app/prices/new"}?more=${Math.min(MAX_OPTIONS, extra + 3)}">More option boxes</a>` : ""}<a class="button ghost" href="/app/prices">Cancel</a></div>
<p class="muted small">Leave an option's prices empty if your team prices it case by case: the bot then tells the customer someone will confirm the price.</p>
</form>
${product ? `<form method="post" action="/app/prices/${product.id}/remove" style="margin-top:24px"><button class="danger small">Take this product off the price list</button></form>` : ""}`,
      problems.length ? 400 : 200,
    );
  };

  const extraSlots = (c: AppContext) => Math.min(MAX_OPTIONS, Math.max(2, Number(c.req.query("more")) || 2));

  app.get("/prices/new", (c) => formPage(c, null, null, [], extraSlots(c) + 1));

  app.get("/prices/:id", async (c) => {
    const id = c.req.param("id");
    const product = UUID.test(id) ? await c.get("biz").prices.product(id) : null;
    if (!product) return ctx.render(c, "Not found", "/app/prices", `<p>That product isn't on your list. <a href="/app/prices">Back</a></p>`, 404);
    return formPage(c, product, null, [], extraSlots(c));
  });

  async function save(c: AppContext, id: string | null) {
    const biz = c.get("biz");
    const existing = id ? await biz.prices.product(id) : null;
    if (id && !existing) return c.redirect("/app/prices", 303);
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    const { input, problems } = readProductForm(form);
    let photo: { data: Uint8Array; type: "image/jpeg" | "image/png" } | null = null;
    const file = form.photo;
    if (biz.photos && file instanceof File && file.size > 0) {
      if (file.size > MAX_PHOTO) problems.push("The photo is too big. Please use one under 5 MB.");
      else {
        const data = new Uint8Array(await file.arrayBuffer());
        const type = isPhoto(data);
        if (!type) problems.push("The photo must be a JPEG or PNG picture.");
        else photo = { data, type };
      }
    }
    if (problems.length) return formPage(c, existing, input, problems, 0);
    let productId: string;
    try {
      productId = await biz.prices.save(id, input);
    } catch (err) {
      if (err instanceof DuplicateProductError) return formPage(c, existing, input, [`You already have a product called "${input.name}". Open it from the price list instead.`], 0);
      throw err;
    }
    if (photo && biz.photos) await biz.photos.savePhoto(productId, photo.data, photo.type);
    ctx.log.info(`Owner app: ${biz.name} saved product "${input.name}"`);
    return c.redirect("/app/prices?msg=saved", 303);
  }

  app.post("/prices/new", (c) => save(c, null));
  app.post("/prices/:id", (c) => (UUID.test(c.req.param("id")) ? save(c, c.req.param("id")) : c.redirect("/app/prices", 303)));

  app.post("/prices/:id/remove", async (c) => {
    const id = c.req.param("id");
    if (UUID.test(id)) await c.get("biz").prices.remove(id);
    return c.redirect("/app/prices?msg=removed", 303);
  });

  app.get("/prices/:id/photo", async (c) => {
    const biz = c.get("biz");
    const id = c.req.param("id");
    const product = UUID.test(id) ? await biz.prices.product(id) : null;
    const image = product?.photoPath && biz.photos ? await biz.photos.photo(product.photoPath) : null;
    if (!image) return c.notFound();
    return c.body(image.data as unknown as ArrayBuffer, 200, { "Content-Type": image.mimeType, "Cache-Control": "private, max-age=300" });
  });
}

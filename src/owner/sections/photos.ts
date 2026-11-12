import type { Hono } from "hono";
import type { SectionContext } from "../index.js";
import { esc, icon } from "../layout.js";
import { BARCODE_KEY_JS, barcodeKey, scannerBox } from "../scanner.js";
import type { AppContext, Env } from "../types.js";
import { isPhoto } from "./prices.js";

// Photos for a long price list (a supermarket's 300 products, a designer's
// styles), without opening each product:
//
// - The photo walk shows the next product with no photo. The owner takes its
//   picture or picks one from the gallery, and the next product comes up. With
//   barcodes on, scanning a shelf barcode jumps to that product.
// - Many photos at once: each picked photo is matched to a product by its file
//   name or barcode ("Peak milk tin.jpg", "5000159484695.jpg"); the owner
//   checks the matches, fixes or fills the rest, and saves.
//
// Photos are shrunk on the phone before they're sent (a 4 MB camera photo
// becomes about 200 KB) and go up one at a time, because file storage turns a
// burst of uploads away.

const UUID = /^[0-9a-f-]{36}$/;
const MAX_PHOTO = 5 * 1024 * 1024;
/** The longest side after shrinking: sharp on a product card, light on data. */
const PHOTO_SIDE = 1200;

/**
 * Finds the product a photo's file name points to, in the browser. Products
 * are { name, codes } with codes already through barcodeKey. A barcode file
 * name wins, then the exact name ("peak-milk_tin (2).jpg" is "peak milk tin"),
 * then the longest product name inside the file name if only one has that length.
 */
export const MATCH_JS = `function plainName(s) {
  return s.toLowerCase().replace(/\\.[a-z0-9]{2,5}$/, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function matchPhoto(fileName, products) {
  const name = plainName(fileName);
  if (!name) return null;
  const digits = name.replace(/ /g, "");
  if (/^\\d{6,}$/.test(digits)) {
    const code = barcodeKey(digits);
    const byCode = products.find((p) => p.codes.includes(code));
    if (byCode) return byCode;
  }
  const bare = name.replace(/ \\d{1,2}$/, "");
  const exact = products.find((p) => plainName(p.name) === name) || products.find((p) => plainName(p.name) === bare);
  if (exact) return exact;
  const padded = " " + name + " ";
  let best = [];
  for (const p of products) {
    const n = plainName(p.name);
    if (n.length < 3 || !padded.includes(" " + n + " ")) continue;
    if (!best.length || n.length > plainName(best[0].name).length) best = [p];
    else if (n.length === plainName(best[0].name).length) best.push(p);
  }
  return best.length === 1 ? best[0] : null;
}`;

interface WalkProduct {
  id: string;
  name: string;
  category: string | null;
  options: string;
  codes: string[];
  photo: boolean;
}

/** JSON for a <script> block: "<" escaped so a product name can't end the script. */
const scriptJson = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

export function registerPhotos(app: Hono<Env>, ctx: SectionContext) {
  app.get("/prices/photos", async (c) => {
    const denied = await ctx.need(c, "edit_prices");
    if (denied) return denied;
    const biz = c.get("biz");
    if (!biz.photos) {
      return ctx.render(c, "Product photos", "/home/prices", `<p>Product photos come with the plans that include the catalogue. Send <b>plan</b> to your bot on WhatsApp to upgrade.</p>`);
    }
    const products: WalkProduct[] = (await biz.prices.products())
      .map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category ?? null,
        options: p.options.map((o) => o.name).join(", "),
        codes: biz.barcodes ? p.options.flatMap((o) => (o.barcode ? [barcodeKey(o.barcode)] : [])) : [],
        photo: Boolean(p.photoPath),
      }))
      .sort((a, b) => (a.category ?? "~").localeCompare(b.category ?? "~") || a.name.localeCompare(b.name));
    if (!products.length) {
      return ctx.render(c, "Product photos", "/home/prices", `<p>Your price list is empty. <a href="/home/prices/new">Add products</a> first, then come back for their photos.</p>`);
    }
    const categories = [...new Set(products.flatMap((p) => (p.category ? [p.category] : [])))];
    const withPhoto = products.filter((p) => p.photo).length;
    const hide = 'style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden"';
    return ctx.render(
      c,
      "Product photos",
      "/home/prices",
      `<style>#photos [hidden]{display:none!important}</style><div id="photos">
<p id="count" class="muted">${withPhoto} of ${products.length} products have a photo.</p>
<section class="card" style="position:relative">
<h2>Photo walk</h2>
<p class="muted">Each product without a photo comes up in turn. Take its picture or pick one from your gallery, and the next one comes up while the last one saves. Walk the shelves, or sit with your saved pictures.</p>
<div class="row">${categories.length ? `<label>Shelf or category<select id="cat"><option value="">All products</option>${categories.map((x) => `<option>${esc(x)}</option>`).join("")}</select></label>` : ""}
<label style="flex:0 1 auto"><input type="checkbox" id="missing" checked> Only products without a photo</label></div>
<div id="walk" style="margin-top:16px">
<div style="display:flex;gap:14px;align-items:center"><img id="w-img" class="thumb" alt="" style="width:96px;height:96px" hidden><div id="w-letter" class="thumb" style="width:96px;height:96px"></div>
<div style="min-width:0"><p class="muted small" id="w-pos" style="margin:0"></p><h3 id="w-name" style="margin:2px 0"></h3><p class="muted small" id="w-more" style="margin:0"></p></div></div>
<div class="actions"><label class="button">${icon("camera", 18)}Take photo<input type="file" id="w-camera" accept="image/*" capture="environment" ${hide}></label>
<label class="button ghost">${icon("upload", 18)}From gallery<input type="file" id="w-gallery" accept="image/*" ${hide}></label></div>
<div class="actions" style="margin-top:10px"><button type="button" class="ghost small" id="w-back">Back</button><button type="button" class="ghost small" id="w-skip">Skip</button>${biz.barcodes ? `<button type="button" class="ghost small" id="w-scan">${icon("barcode", 16)}Scan a barcode</button>` : ""}</div>
<label>Go to a product<input id="w-jump" list="names" autocomplete="off" placeholder="Type its name"></label>
</div>
<p id="w-done" hidden><b>Done.</b> Every product here has a photo. Pick another shelf, or untick "Only products without a photo" to change one.</p>
${biz.barcodes ? scannerBox() : ""}
</section>
<section class="card" style="position:relative;margin-top:16px">
<h2>Many photos at once</h2>
<p class="muted">If your photos are named after your products or their barcodes (for example "Peak milk tin.jpg" or "5000159484695.jpg"), pick them all here and each one finds its product. Check the matches, type the product for any that didn't match, then save.</p>
<label class="button ghost">${icon("upload", 18)}Choose photos<input type="file" id="b-files" accept="image/*" multiple ${hide}></label>
<div id="b-rows" style="display:grid;gap:10px;margin-top:16px"></div>
<div class="actions" id="b-actions" hidden><button type="button" id="b-go"></button><button type="button" class="ghost" id="b-clear">Clear</button></div>
</section>
<p id="status" class="muted" aria-live="polite" style="position:sticky;bottom:12px;background:var(--surface2);border-radius:12px;padding:10px 14px" hidden></p>
<datalist id="names">${products.map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist>
<p><a class="button ghost small" href="/home/prices">Back to the price list</a></p></div>
<script type="application/json" id="products">${scriptJson(products)}</script>
<script>
(function () {
  ${BARCODE_KEY_JS}
  ${MATCH_JS}
  const all = JSON.parse(document.getElementById("products").textContent);
  const byName = (n) => { const k = n.trim().toLowerCase(); return all.find((p) => p.name.toLowerCase() === k) || null; };
  const $ = (id) => document.getElementById(id);
  const statusLine = $("status");
  const failed = [];
  function say(text) {
    const missed = failed.length ? " Didn't save: " + failed.join(", ") + ". Go back to them and try again." : "";
    statusLine.textContent = (text + missed).trim();
    statusLine.hidden = !statusLine.textContent;
  }
  function counts() { $("count").textContent = all.filter((p) => p.photo).length + " of " + all.length + " products have a photo."; }

  // Shrinks a photo to ${PHOTO_SIDE}px on its longest side, as a JPEG on white.
  async function shrink(file) {
    let img;
    try {
      img = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      img = await new Promise((ok, fail) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => fail(new Error("unreadable"));
        i.src = URL.createObjectURL(file);
      });
    }
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const scale = Math.min(1, ${PHOTO_SIDE} / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("unreadable"))), "image/jpeg", 0.85));
  }

  // One upload at a time, in the background.
  const queue = [];
  let busy = false;
  function send(product, file, done) {
    queue.push({ product, file, done });
    pump();
  }
  function progress() {
    const left = queue.length + (busy ? 1 : 0);
    if (left) say("Saving " + left + " photo" + (left === 1 ? "" : "s") + "… keep this page open.");
  }
  async function pump() {
    if (busy) return;
    const job = queue.shift();
    if (!job) return;
    busy = true;
    progress();
    let problem = null;
    try {
      const body = new FormData();
      body.append("photo", await shrink(job.file), "photo.jpg");
      const res = await fetch("/home/prices/" + job.product.id + "/photo", { method: "POST", body, credentials: "same-origin" });
      if (!res.ok) problem = ((await res.json().catch(() => ({}))).error) || "It didn't save.";
    } catch (e) {
      problem = e && e.message === "unreadable" ? "That picture couldn't be opened. Use a JPEG or PNG photo." : "It didn't save. Check the internet connection.";
    }
    busy = false;
    if (!problem) {
      job.product.photo = true;
      job.product.v = Date.now();
    }
    job.done(problem);
    counts();
    if (!queue.length) say(problem ? "" : "Photos saved.");
    pump();
  }

  // The photo walk.
  let list = [], at = 0;
  const cat = $("cat"), missing = $("missing");
  const wanted = (p) => !missing.checked || !p.photo;
  function build() {
    list = all.filter((p) => !cat || !cat.value || p.category === cat.value);
    at = list.findIndex(wanted);
    show();
  }
  function show() {
    const p = at >= 0 ? list[at] : null;
    $("walk").hidden = !p;
    $("w-done").hidden = Boolean(p);
    if (!p) return;
    const left = list.filter((x) => !x.photo).length;
    $("w-pos").textContent = left + " still need a photo" + (cat && cat.value ? " on this shelf" : "");
    $("w-name").textContent = p.name;
    $("w-more").textContent = [p.category, p.options].filter(Boolean).join(" · ");
    const src = p.local || (p.photo ? "/home/prices/" + p.id + "/photo?v=" + (p.v || 0) : "");
    $("w-img").hidden = !src;
    if (src) $("w-img").src = src;
    $("w-letter").hidden = Boolean(src);
    $("w-letter").textContent = p.name.slice(0, 1).toUpperCase();
  }
  function move(step) {
    for (let i = at + step; i >= 0 && i < list.length; i += step) {
      if (wanted(list[i])) { at = i; return show(); }
    }
    if (step > 0) { at = -1; show(); }
  }
  function goTo(p) {
    let i = list.indexOf(p);
    if (i < 0) { list.splice(at < 0 ? list.length : at, 0, p); i = list.indexOf(p); }
    at = i;
    show();
    $("walk").scrollIntoView({ block: "nearest" });
  }
  function took(input) {
    const file = input.files && input.files[0];
    input.value = "";
    const p = list[at];
    if (!file || !p) return;
    const i = failed.indexOf(p.name);
    if (i >= 0) failed.splice(i, 1);
    p.local = URL.createObjectURL(file);
    send(p, file, (problem) => {
      if (problem) {
        p.local = null;
        p.photo = false;
        failed.push(p.name);
        say(p.name + ": " + problem);
      }
      if (list[at] === p) show();
    });
    // Counted as done straight away, so the next product comes up while this one saves.
    p.photo = true;
    move(1);
  }
  $("w-camera").onchange = (e) => took(e.target);
  $("w-gallery").onchange = (e) => took(e.target);
  $("w-skip").onclick = () => move(1);
  $("w-back").onclick = () => {
    const i = (at < 0 ? list.length : at) - 1;
    if (i >= 0) { at = i; show(); }
  };
  $("w-jump").onchange = (e) => {
    const p = byName(e.target.value);
    if (p) { e.target.value = ""; goTo(p); }
  };
  if (cat) cat.onchange = build;
  missing.onchange = build;
  if ($("w-scan")) $("w-scan").onclick = () => scanBarcodes((code) => {
    const p = all.find((x) => x.codes.includes(barcodeKey(code)));
    if (p) goTo(p);
    else say("No product has barcode " + code + ". Add it on the product's page first.");
  }, false);
  build();

  // Many photos at once.
  let rows = [];
  function render() {
    const counted = new Map();
    rows.forEach((r) => { const p = byName(r.input.value); if (p && !r.done) counted.set(p, (counted.get(p) || 0) + 1); });
    let ready = 0;
    rows.forEach((r) => {
      if (r.done) return;
      const p = byName(r.input.value);
      if (p) ready++;
      r.note.textContent = !r.input.value.trim() ? "No match: type the product, or leave it empty to skip it."
        : !p ? "No product has that name."
        : counted.get(p) > 1 ? "Two photos are matched to this product: the last one saved is kept."
        : p.photo ? "Replaces its photo." : "";
      r.note.className = "small muted";
      r.note.style.color = p && counted.get(p) === 1 ? "" : "var(--red)";
    });
    $("b-actions").hidden = !rows.length;
    $("b-go").hidden = !ready;
    $("b-go").textContent = "Save " + ready + " photo" + (ready === 1 ? "" : "s");
  }
  $("b-files").onchange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "card";
      row.style.cssText = "display:flex;gap:12px;align-items:center;padding:10px";
      const img = document.createElement("img");
      img.className = "thumb";
      img.loading = "lazy";
      img.src = URL.createObjectURL(file);
      const box = document.createElement("div");
      box.style.cssText = "flex:1;min-width:0";
      const label = document.createElement("p");
      label.className = "muted small";
      label.style.cssText = "margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      label.textContent = file.name;
      const input = document.createElement("input");
      input.setAttribute("list", "names");
      input.setAttribute("aria-label", "Product for " + file.name);
      input.autocomplete = "off";
      const match = matchPhoto(file.name, all);
      input.value = match ? match.name : "";
      const note = document.createElement("p");
      note.style.margin = "4px 0 0";
      box.append(label, input, note);
      row.append(img, box);
      $("b-rows").append(row);
      const r = { file, input, note, row, done: false };
      input.oninput = render;
      rows.push(r);
    }
    render();
  };
  $("b-clear").onclick = () => { rows = []; $("b-rows").textContent = ""; render(); };
  $("b-go").onclick = () => {
    for (const r of rows) {
      const p = r.done ? null : byName(r.input.value);
      if (!p) continue;
      r.done = true;
      r.input.disabled = true;
      r.note.style.color = "";
      r.note.textContent = "Waiting to save…";
      send(p, r.file, (problem) => {
        r.note.style.color = problem ? "var(--red)" : "";
        r.note.textContent = problem || "Saved.";
        if (problem) { r.done = false; r.input.disabled = false; render(); }
      });
    }
    render();
  };
})();
</script>`,
    );
  });

  // One product's photo, sent by the page above. Answers in JSON for its script.
  app.post("/prices/:id/photo", async (c: AppContext) => {
    const biz = c.get("biz");
    const id = c.req.param("id") ?? "";
    if (!biz.photos) return c.json({ error: "Product photos aren't on for your plan." }, 400);
    const product = UUID.test(id) ? await biz.prices.product(id) : null;
    if (!product) return c.json({ error: "That product isn't on your price list any more." }, 404);
    const file = (await c.req.parseBody()).photo;
    if (!(file instanceof File) || !file.size) return c.json({ error: "No photo came through." }, 400);
    if (file.size > MAX_PHOTO) return c.json({ error: "The photo is too big. Please use one under 5 MB." }, 400);
    const data = new Uint8Array(await file.arrayBuffer());
    const type = isPhoto(data);
    if (!type) return c.json({ error: "The photo must be a JPEG or PNG picture." }, 400);
    await biz.photos.savePhoto(product.id, data, type);
    ctx.log.info(`Owner app: ${biz.name} added a photo for "${product.name}"`);
    return c.json({ ok: true });
  });
}

import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { basicAuth } from "hono/basic-auth";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { formatNaira } from "../../core/money.js";
import { fetchSheet as defaultFetchSheet, parseCsv } from "../../core/sheets.js";
import {
  DRAFT_IMAGE_TYPES,
  MAX_DRAFT_IMAGE_BYTES,
  MAX_DRAFT_IMAGES,
  MAX_DRAFT_TEXT,
  draftToCsv,
  type DraftImage,
  type DraftImageType,
  type PriceListDrafter,
} from "./drafter.js";
import { TEMPLATE_CSV_URL, TEMPLATE_SHEET_URL, priceListCsv, readPriceList, type PriceListItem, type PriceListProblem } from "./pricelist.js";
import {
  DEFAULT_BUSINESS_ID,
  NumberTakenError,
  type BusinessSettings,
  type BusinessStore,
  type QuoteBusiness,
  type SetupStore,
} from "./store.js";

// The owner setup screen at /quote-setup: add a business to the quote bot, set
// its name, WhatsApp number and alert number, and type or upload its price
// list (a CSV file, pasted rows or a Google Sheet link). Switched off unless
// QUOTE_SETUP_PASSWORD is set; the browser asks for that password.
//
// A new price list is always checked and shown first, and only saved when the
// owner presses Save. Prices are typed in naira and saved in kobo.

export interface QuoteSetupDeps {
  password: string;
  businesses: BusinessStore;
  setup: SetupStore;
  /** WhatsApp Phone number IDs no business may use: the main number and the other products' numbers. */
  reservedNumberIds: string[];
  /** Whether QUOTE_MULTI_BUSINESS is on (otherwise only business #1 answers customers). */
  multiBusinessOn: boolean;
  fetchSheet?: (link: string) => Promise<string>;
  /** Drafts a price list from the owner's description or photos. Off (no button) when not given. */
  drafter?: PriceListDrafter;
  /** Most AI drafts allowed per day across all businesses, so the AI bill can't run away. */
  draftsPerDay?: number;
  /**
   * Branches (QUOTE_BRANCHES, migration 0038): a business can be a branch of
   * another. limit() is how many numbers the main business's plan allows in
   * all, itself included (null = no cap).
   */
  branches?: { limit(mainId: string): Promise<number | null> };
  log?: Pick<Console, "error">;
}

const MAX_UPLOAD_BYTES = 1024 * 1024;
const DEFAULT_DRAFTS_PER_DAY = 30;

export function createQuoteSetup(deps: QuoteSetupDeps) {
  const app = new Hono();
  const log = deps.log ?? console;
  const fetchSheet = deps.fetchSheet ?? defaultFetchSheet;
  const drafts = { day: "", count: 0 };

  app.use(
    "*",
    basicAuth({
      verifyUser: (_username, password) => samePassword(password, deps.password),
      realm: "yarnOga quote bot setup",
    }),
  );

  // The browser sends the password with every request, so a form on another
  // website could post here on the owner's behalf. Only accept forms sent from
  // this site's own pages.
  app.use("*", async (c, next) => {
    if (c.req.method === "POST" && !sameSite(c)) return c.text("This form must be sent from the setup page itself.", 403);
    c.header("Cache-Control", "no-store");
    c.header("X-Frame-Options", "DENY");
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse(); // e.g. the password prompt
    log.error("Quote setup page failed:", err);
    return c.html(page("Something went wrong", `<p>The page couldn't load just now. If you've just switched this on, check that migrations 0020 and 0023 have been run in Supabase.</p><p><a href="/quote-setup">Back</a></p>`), 500);
  });

  app.get("/", async (c) => {
    const list = await deps.businesses.list();
    const rows = list
      .map(
        (b) => `<tr><td><a href="/quote-setup/b/${b.id}">${esc(b.name)}</a>${b.id === DEFAULT_BUSINESS_ID ? ' <span class="tag">main number</span>' : ""}${b.branchOf ? ' <span class="tag">branch</span>' : ""}</td>
<td>${b.id === DEFAULT_BUSINESS_ID ? "main number" : b.phoneNumberId ? esc(b.phoneNumberId) : '<span class="warn">not set</span>'}</td>
<td>${b.active ? "On" : '<span class="muted">Off</span>'}</td>
<td><a href="/quote-setup/b/${b.id}/prices">Price list</a></td></tr>`,
      )
      .join("");
    return c.html(
      page(
        "Quote bot businesses",
        `${deps.multiBusinessOn ? "" : `<p class="notice">QUOTE_MULTI_BUSINESS is off on Railway, so only the main number's business answers customers. You can still set businesses up here first.</p>`}
<table><thead><tr><th>Business</th><th>WhatsApp number ID</th><th>Answering</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<p><a class="button" href="/quote-setup/new">Add a business</a></p>`,
      ),
    );
  });

  app.get("/new", async (c) => c.html(page("Add a business", await form("/quote-setup/new", emptySettings(), []))));

  app.post("/new", async (c) => {
    const { settings, problems } = await readForm(await c.req.parseBody());
    if (problems.length) return c.html(page("Add a business", await form("/quote-setup/new", settings, problems)), 400);
    try {
      const business = await deps.setup.createBusiness(settings);
      return c.redirect(`/quote-setup/b/${business.id}/prices?new=1`, 303);
    } catch (err) {
      if (err instanceof NumberTakenError) {
        return c.html(page("Add a business", await form("/quote-setup/new", settings, [NUMBER_TAKEN])), 400);
      }
      throw err;
    }
  });

  app.get("/b/:id", async (c) => {
    const business = await found(c.req.param("id"));
    if (!business) return c.notFound();
    if (business.id === DEFAULT_BUSINESS_ID) return c.html(page(business.name, mainBusinessNote(business)));
    const saved = c.req.query("saved") ? `<p class="ok">Saved. Customers see the change within a minute.</p>` : "";
    return c.html(page(business.name, saved + (await form(`/quote-setup/b/${business.id}`, business, [], business.id))));
  });

  app.post("/b/:id", async (c) => {
    const business = await found(c.req.param("id"));
    if (!business) return c.notFound();
    if (business.id === DEFAULT_BUSINESS_ID) return c.html(page(business.name, mainBusinessNote(business)), 400);
    const { settings, problems } = await readForm(await c.req.parseBody(), business.id);
    if (problems.length) return c.html(page(business.name, await form(`/quote-setup/b/${business.id}`, settings, problems, business.id)), 400);
    try {
      await deps.setup.updateBusiness(business.id, settings);
      return c.redirect(`/quote-setup/b/${business.id}?saved=1`, 303);
    } catch (err) {
      if (err instanceof NumberTakenError) {
        return c.html(page(business.name, await form(`/quote-setup/b/${business.id}`, settings, [NUMBER_TAKEN], business.id)), 400);
      }
      throw err;
    }
  });

  app.get("/b/:id/prices", async (c) => {
    const business = await found(c.req.param("id"));
    if (!business) return c.notFound();
    const items = await deps.setup.priceList(business.id);
    const intro = c.req.query("new")
      ? `<p class="ok">${esc(business.name)} is set up. Now add its price list.</p>`
      : c.req.query("saved")
        ? `<p class="ok">Price list saved. Customers get the new prices from their next message.</p>`
        : "";
    return c.html(
      page(
        `${business.name}: price list`,
        `${intro}${items.length ? priceTable(items) : `<p class="muted">No price list yet.</p>`}
${items.length ? `<p><a href="/quote-setup/b/${business.id}/prices.csv">Download it as a spreadsheet (CSV)</a> to edit and upload again.</p>` : ""}
${deps.drafter ? draftForm(business.id, "") : ""}
${uploadForm(business.id, "")}`,
      ),
    );
  });

  // The AI reads the owner's description or photos and fills the "type it
  // here" box with draft rows. Nothing is saved: the owner checks the rows,
  // then the usual Check and Save steps apply.
  app.post(
    "/b/:id/prices/draft",
    bodyLimit({
      maxSize: MAX_DRAFT_IMAGES * MAX_DRAFT_IMAGE_BYTES + 64 * 1024,
      onError: (c) => c.text("That's too much to send at once. Use up to 3 photos, each under 3.5 MB.", 413),
    }),
    async (c) => {
      const business = await found(c.req.param("id"));
      if (!business) return c.notFound();
      if (!deps.drafter) return c.notFound();
      const title = `${business.name}: price list`;
      const form = await c.req.parseBody({ all: true });
      const text = field(form, "describe").trim();

      let images: DraftImage[];
      try {
        images = await draftImages(form.photos);
        if (text.length > MAX_DRAFT_TEXT) throw new Error(`Please keep the description under ${MAX_DRAFT_TEXT} letters, or send a photo instead.`);
        if (!text && !images.length) throw new Error("Describe what you sell with prices, or add a photo of your price list.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.html(page(title, `<p class="error">${esc(message)}</p>${draftForm(business.id, text)}${uploadForm(business.id, "")}`), 400);
      }

      const today = new Date().toISOString().slice(0, 10);
      if (drafts.day !== today) Object.assign(drafts, { day: today, count: 0 });
      if (drafts.count >= (deps.draftsPerDay ?? DEFAULT_DRAFTS_PER_DAY)) {
        return c.html(
          page(title, `<p class="error">The AI has drafted enough price lists for today. Please type or upload the list below, or try again tomorrow.</p>${uploadForm(business.id, "")}`),
          429,
        );
      }
      drafts.count++;

      let draft;
      try {
        draft = await deps.drafter.draft({ businessName: business.name, description: business.description, text, images });
      } catch (err) {
        log.error("Price list draft failed:", err);
        return c.html(
          page(title, `<p class="error">The AI couldn't read that just now. Try again, or type the list below.</p>${draftForm(business.id, text)}${uploadForm(business.id, "")}`),
          502,
        );
      }
      // Only text typed by the owner can be checked word for word; prices read from a photo can't.
      const { csv, droppedPrices } = draftToCsv(draft, images.length ? null : text);
      if (csv.split("\n").filter(Boolean).length < 2) {
        return c.html(
          page(title, `<p class="error">The AI didn't find anything to put on the price list. Add more detail or a clearer photo.</p>${draftForm(business.id, text)}${uploadForm(business.id, "")}`),
          422,
        );
      }
      const flags = [
        draft.notes ? esc(draft.notes) : "",
        droppedPrices
          ? `${droppedPrices} price${droppedPrices === 1 ? " was" : "s were"} left empty because ${droppedPrices === 1 ? "it isn't" : "they aren't"} in what you typed. Fill ${droppedPrices === 1 ? "it" : "them"} in, or leave empty for items the team prices by hand.`
          : "",
      ].filter(Boolean);
      return c.html(
        page(
          `${business.name}: check the AI's draft`,
          `<p class="notice"><b>This is only a draft, nothing is saved.</b> The AI can misread things, so check every product and price against your own list and correct them in the box below. Then press <b>Check it</b> to see the list, and <b>Save this price list</b> when it's right.</p>
${flags.map((f) => `<p class="warn">${f}</p>`).join("")}
${uploadForm(business.id, csv)}`,
        ),
      );
    },
  );

  app.get("/b/:id/prices.csv", async (c) => {
    const business = await found(c.req.param("id"));
    if (!business) return c.notFound();
    const items = await deps.setup.priceList(business.id);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="price-list.csv"`);
    return c.body(priceListCsv(items.length ? items : EXAMPLE));
  });

  // Step 1: read what the owner sent and show it back, without saving.
  app.post("/b/:id/prices/check", async (c) => {
    const business = await found(c.req.param("id"));
    if (!business) return c.notFound();
    const form = await c.req.parseBody();
    let csv: string;
    try {
      csv = await uploadedCsv(form);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.html(page(`${business.name}: price list`, `<p class="error">${esc(message)}</p>${uploadForm(business.id, field(form, "pasted"))}`), 400);
    }
    const { items, problems } = readPriceList(parseCsv(csv));
    if (problems.length || !items.length) {
      return c.html(
        page(
          `${business.name}: price list`,
          `${problemList(problems.length ? problems : [{ line: 1, message: "No prices found." }])}
<p>Nothing has been saved. Fix these rows and try again.</p>${uploadForm(business.id, csv)}`,
        ),
        400,
      );
    }
    const current = await deps.setup.priceList(business.id);
    return c.html(
      page(
        `${business.name}: check the new price list`,
        `<p>This is what customers will be quoted from. Nothing is saved until you press <b>Save this price list</b>.</p>
${changeSummary(current, items)}
${priceTable(items)}
<form method="post" action="/quote-setup/b/${business.id}/prices/save">
<textarea name="csv" hidden>${esc(priceListCsv(items))}</textarea>
<p><button type="submit">Save this price list</button> <a href="/quote-setup/b/${business.id}/prices">Cancel</a></p>
</form>`,
      ),
    );
  });

  // Step 2: save the checked list (read again, so nothing unchecked slips in).
  app.post("/b/:id/prices/save", async (c) => {
    const business = await found(c.req.param("id"));
    if (!business) return c.notFound();
    const { items, problems } = readPriceList(parseCsv(field(await c.req.parseBody(), "csv")));
    if (problems.length || !items.length) {
      return c.html(page(`${business.name}: price list`, `${problemList(problems)}${uploadForm(business.id, "")}`), 400);
    }
    await deps.setup.replacePriceList(business.id, items);
    return c.redirect(`/quote-setup/b/${business.id}/prices?saved=1`, 303);
  });

  /** The businesses this one could be a branch of: main businesses other than itself. Null with branches off. */
  async function mainChoices(selfId?: string): Promise<QuoteBusiness[] | null> {
    if (!deps.branches) return null;
    const all = await deps.businesses.list();
    if (selfId && all.some((b) => b.branchOf === selfId)) return []; // it has branches of its own
    return all.filter((b) => !b.branchOf && b.id !== selfId);
  }

  async function form(action: string, settings: BusinessSettings, problems: string[], selfId?: string): Promise<string> {
    return businessForm(action, settings, problems, await mainChoices(selfId));
  }

  /** The settings form, plus the branch choice checked against the main business's plan. */
  async function readForm(body: Record<string, unknown>, selfId?: string) {
    const result = readSettings(body, deps.reservedNumberIds);
    if (!deps.branches) return result;
    const wanted = field(body, "branchOf") || null;
    result.settings.branchOf = wanted;
    if (!wanted) return result;
    const all = await deps.businesses.list();
    const main = (await mainChoices(selfId))?.find((b) => b.id === wanted);
    if (!main) {
      result.problems.push(
        selfId && all.some((b) => b.branchOf === selfId)
          ? "This business has branches of its own, so it can't be a branch."
          : "Pick the main business this is a branch of.",
      );
      return result;
    }
    const limit = await deps.branches.limit(main.id);
    const numbers = 2 + all.filter((b) => b.branchOf === main.id && b.id !== selfId).length;
    if (limit !== null && numbers > limit) {
      result.problems.push(
        limit <= 1
          ? `${main.name}'s plan doesn't include branches. Growth allows up to 3 numbers.`
          : `${main.name}'s plan allows ${limit} numbers in all, and they're all in use.`,
      );
    }
    return result;
  }

  async function found(id: string): Promise<QuoteBusiness | null> {
    return /^[0-9a-f-]{36}$/i.test(id) ? deps.businesses.get(id) : null;
  }

  /** The price list the owner sent: a file, a Google Sheet link, or pasted rows (in that order). */
  async function uploadedCsv(form: Record<string, unknown>): Promise<string> {
    const file = form.file;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("That file is too big. Price lists must be under 1 MB.");
      if (/\.(xlsx?|ods|numbers)$/i.test(file.name)) {
        throw new Error("Please save the spreadsheet as CSV first (File > Download > CSV in Google Sheets, or Save As > CSV in Excel).");
      }
      return file.text();
    }
    const link = field(form, "sheet").trim();
    if (link) {
      try {
        return await fetchSheet(link);
      } catch (err) {
        throw new Error(`Couldn't read that Google Sheet: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const pasted = field(form, "pasted");
    if (pasted.trim()) return pasted;
    throw new Error("Choose a file, paste a Google Sheet link, or type the price list in the box.");
  }

  return app;
}

/** The photos sent with a draft request, checked for count, size and type. */
async function draftImages(value: unknown): Promise<DraftImage[]> {
  const files = (Array.isArray(value) ? value : [value]).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_DRAFT_IMAGES) throw new Error(`Send up to ${MAX_DRAFT_IMAGES} photos at a time.`);
  const images: DraftImage[] = [];
  for (const file of files) {
    if (file.size > MAX_DRAFT_IMAGE_BYTES) throw new Error(`"${file.name}" is too big. Each photo must be under 3.5 MB.`);
    const type = file.type.toLowerCase();
    if (!(DRAFT_IMAGE_TYPES as readonly string[]).includes(type)) {
      throw new Error(`"${file.name}" isn't a photo we can read. Use a JPG, PNG or WebP picture or screenshot.`);
    }
    images.push({ mediaType: type as DraftImageType, data: Buffer.from(await file.arrayBuffer()).toString("base64") });
  }
  return images;
}

const NUMBER_TAKEN = "Another business already uses that WhatsApp number ID.";

const EXAMPLE: PriceListItem[] = [
  { product: "Branded T-shirts", option: "white, one-colour print", minQuantity: 10, tiers: [{ minQuantity: 10, unitPriceKobo: 500_000 }, { minQuantity: 50, unitPriceKobo: 420_000 }] },
  { product: "Custom cakes", option: "any size", minQuantity: 1, tiers: [] },
];

function emptySettings(): BusinessSettings {
  return { name: "", description: null, orderPrefix: "", phoneNumberId: null, ownerWaId: null, businessDetails: null, paymentDetails: null, active: false };
}

function field(form: Record<string, unknown>, name: string): string {
  const value = form[name];
  return typeof value === "string" ? value : "";
}

/** Reads and checks the business settings form. */
export function readSettings(
  form: Record<string, unknown>,
  reservedNumberIds: string[],
): { settings: BusinessSettings; problems: string[] } {
  const text = (name: string, max: number) => field(form, name).trim().slice(0, max);
  const optional = (value: string) => value || null;
  const settings: BusinessSettings = {
    name: text("name", 200).replace(/\s+/g, " "),
    description: optional(text("description", 500).replace(/\s+/g, " ")),
    orderPrefix: text("orderPrefix", 20).toUpperCase(),
    phoneNumberId: optional(text("phoneNumberId", 40).replace(/\s/g, "")),
    ownerWaId: optional(text("ownerWaId", 40).replace(/\D/g, "")),
    businessDetails: optional(text("businessDetails", 1000)),
    paymentDetails: optional(text("paymentDetails", 1000)),
    active: field(form, "active") === "on",
  };
  const problems: string[] = [];
  if (!settings.name) problems.push("Give the business a name.");
  else if (settings.name.length > 80) problems.push("The business name is too long (80 letters at most).");
  if ((settings.description ?? "").length > 120) problems.push("Keep \"what the business does\" short (120 letters at most).");
  if (!/^[A-Z]{1,6}$/.test(settings.orderPrefix)) problems.push("The order prefix must be 1 to 6 letters, e.g. MC for MC-1001.");
  if (settings.phoneNumberId && !/^\d{5,20}$/.test(settings.phoneNumberId)) {
    problems.push("The WhatsApp number ID is the long number Meta calls \"Phone number ID\" (digits only), not the phone number.");
  } else if (settings.phoneNumberId && reservedNumberIds.includes(settings.phoneNumberId)) {
    problems.push("That WhatsApp number is already used by another yarnOga product, so it can't answer for this business.");
  }
  if (settings.ownerWaId && !/^\d{8,15}$/.test(settings.ownerWaId)) {
    problems.push("Write the alert number in international format, e.g. 2348012345678.");
  }
  if ((settings.businessDetails ?? "").length > 300 || (settings.paymentDetails ?? "").length > 300) {
    problems.push("Keep the invoice details under 300 letters each.");
  }
  if (settings.active && !settings.phoneNumberId) problems.push("Add the WhatsApp number ID before switching the business on.");
  return { settings, problems };
}

function businessForm(action: string, s: BusinessSettings, problems: string[], mains: QuoteBusiness[] | null = null): string {
  const value = (v: string | null) => esc(v ?? "");
  return `${problems.length ? `<ul class="error">${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
<form method="post" action="${action}" class="stack">
<label>Business name<input name="name" required maxlength="80" value="${value(s.name)}"></label>
<label>What the business does <small>a few words, e.g. "a bakery" or "a print shop". Helps the bot understand customers.</small><input name="description" maxlength="120" value="${value(s.description)}"></label>
<label>Order prefix <small>letters before order numbers, e.g. MC gives MC-1001</small><input name="orderPrefix" required maxlength="6" pattern="[A-Za-z]{1,6}" value="${value(s.orderPrefix)}"></label>
<label>WhatsApp number ID <small>the "Phone number ID" Meta shows for the business's number (not the phone number itself)</small><input name="phoneNumberId" inputmode="numeric" value="${value(s.phoneNumberId)}"></label>
<label>Alert number <small>the owner's WhatsApp number for new orders, e.g. 2348012345678. They can also send "paid MC-1001".</small><input name="ownerWaId" inputmode="tel" value="${value(s.ownerWaId)}"></label>
<label>Address or phone on invoices <small>optional</small><textarea name="businessDetails" rows="2" maxlength="300">${value(s.businessDetails)}</textarea></label>
<label>Bank details on invoices <small>optional, e.g. bank, account number, account name</small><textarea name="paymentDetails" rows="2" maxlength="300">${value(s.paymentDetails)}</textarea></label>
${mains ? branchField(s.branchOf ?? null, mains) : ""}
<label class="check"><input type="checkbox" name="active"${s.active ? " checked" : ""}> Answer customers on this number</label>
<p><button type="submit">Save</button> <a href="/quote-setup">Cancel</a></p>
</form>`;
}

function branchField(current: string | null, mains: QuoteBusiness[]): string {
  const options = mains
    .map((b) => `<option value="${b.id}"${b.id === current ? " selected" : ""}>${esc(b.name)}</option>`)
    .join("");
  return `<label>Branch of <small>a branch is on its main business's plan, and its orders show on the main business's order board</small><select name="branchOf"><option value="">Not a branch</option>${options}</select></label>`;
}

function mainBusinessNote(b: QuoteBusiness): string {
  return `<p>${esc(b.name)} answers on the main WhatsApp number. Its name, alert number and invoice details are set on Railway (QUOTE_BUSINESS_NAME, QUOTE_OWNER_WA_ID, QUOTE_BUSINESS_DETAILS, QUOTE_PAYMENT_DETAILS), so they can't be changed here.</p>
<p><a class="button" href="/quote-setup/b/${b.id}/prices">Price list</a> <a href="/quote-setup">Back</a></p>`;
}

function draftForm(businessId: string, describe: string): string {
  return `<h2>Let AI draft it</h2>
<p>Describe what you sell with your prices, or add photos or screenshots of your price list. The AI writes it out as rows for you to check and correct. Nothing is saved until you check the list and press Save.</p>
<form method="post" action="/quote-setup/b/${businessId}/prices/draft" enctype="multipart/form-data" class="stack">
<label>Describe what you sell<textarea name="describe" rows="5" maxlength="${MAX_DRAFT_TEXT}" placeholder="e.g. Cupcakes N600 each, box of 6 for N3,500. Birthday cakes from N25,000, price depends on size. Minimum order 2 boxes.">${esc(describe)}</textarea></label>
<label>and/or photos of your price list <small>up to ${MAX_DRAFT_IMAGES} pictures or screenshots (JPG, PNG or WebP), each under 3.5 MB</small><input type="file" name="photos" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>
<p><button type="submit">Draft my price list</button></p>
</form>`;
}

function uploadForm(businessId: string, pasted: string): string {
  return `<h2>Upload a new price list</h2>
<p>One row per price, with headings in row 1: <b>Product</b>, <b>Option</b>, <b>Minimum order</b>, <b>From quantity</b>, <b>Price</b> (in naira). Leave the price empty for items the team prices by hand. The new list replaces the whole old one. <a href="/quote-setup/b/${businessId}/prices.csv">Download the current list or an example</a>, or start from our template: <a href="${TEMPLATE_SHEET_URL}" target="_blank" rel="noopener">copy the Google Sheet</a> or <a href="${TEMPLATE_CSV_URL}">download the CSV</a>.</p>
<form method="post" action="/quote-setup/b/${businessId}/prices/check" enctype="multipart/form-data" class="stack">
<label>A CSV file<input type="file" name="file" accept=".csv,text/csv"></label>
<label>or a Google Sheet link <small>shared as "Anyone with the link"</small><input name="sheet" type="url" placeholder="https://docs.google.com/spreadsheets/d/..."></label>
<label>or type it here<textarea name="pasted" rows="8" placeholder="Product,Option,Minimum order,From quantity,Price&#10;Branded T-shirts,white,10,10,5000">${esc(pasted)}</textarea></label>
<p><button type="submit">Check it</button></p>
</form>`;
}

function priceTable(items: PriceListItem[]): string {
  const rows = items
    .map((i) => {
      const prices = i.tiers.length
        ? i.tiers.map((t) => `${formatNaira(t.unitPriceKobo)} each from ${t.minQuantity}`).join("<br>")
        : '<span class="muted">priced by the team</span>';
      return `<tr><td>${esc(i.product)}</td><td>${esc(i.option)}</td><td>${i.minQuantity}</td><td>${prices}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Product</th><th>Option</th><th>Minimum</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function problemList(problems: PriceListProblem[]): string {
  return `<ul class="error">${problems.map((p) => `<li>Row ${p.line}: ${esc(p.message)}</li>`).join("")}</ul>`;
}

/** "3 new, 1 changed, 2 removed", so the owner sees what saving will do. */
function changeSummary(current: PriceListItem[], next: PriceListItem[]): string {
  const key = (i: PriceListItem) => `${i.product.toLowerCase()}\u0000${i.option.toLowerCase()}`;
  const same = (a: PriceListItem, b: PriceListItem) =>
    a.minQuantity === b.minQuantity && JSON.stringify(a.tiers) === JSON.stringify(b.tiers);
  const before = new Map(current.map((i) => [key(i), i]));
  const after = new Set(next.map(key));
  const added = next.filter((i) => !before.has(key(i))).length;
  const changed = next.filter((i) => before.has(key(i)) && !same(before.get(key(i))!, i)).length;
  const removed = current.filter((i) => !after.has(key(i)));
  const parts = [`${added} new`, `${changed} with new prices or minimums`, `${removed.length} taken off`];
  return `<p class="notice">${next.length} items: ${parts.join(", ")}.${
    removed.length ? ` Taken off: ${removed.slice(0, 10).map((i) => esc(`${i.product} (${i.option})`)).join(", ")}${removed.length > 10 ? ", ..." : ""}.` : ""
  }</p>`;
}

function sameSite(c: Context): boolean {
  if (c.req.header("sec-fetch-site") === "same-origin") return true;
  const origin = c.req.header("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === c.req.header("host");
  } catch {
    return false;
  }
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} · yarnOga</title>
<style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0c0d0d;color:#f3f4ef}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:1.5rem;margin:.2em 0 .8em}h2{font-size:1.15rem;margin-top:2em}
a{color:#c6ff1f}small,.muted{color:#9a9d97}small{display:block;font-size:.85rem}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:.95rem}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #2e302f;vertical-align:top}
.stack label{display:block;margin:14px 0;font-weight:600}
input:not([type=checkbox]),textarea,select{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border-radius:8px;border:1px solid #2e302f;background:#191a1a;color:inherit;font:inherit}
.check{font-weight:400!important}button,.button{display:inline-block;background:#c6ff1f;color:#0c0d0d;border:0;border-radius:8px;padding:10px 16px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
.error{color:#ff8a80}.ok{color:#c6ff1f}.warn{color:#ffd166}
.notice{background:#191a1a;border:1px solid #2e302f;border-radius:8px;padding:10px 12px}
.tag{font-size:.75rem;border:1px solid #2e302f;border-radius:6px;padding:1px 6px;color:#9a9d97}
nav{font-size:.9rem;margin-bottom:8px}[hidden]{display:none!important}
</style></head><body><main><nav><a href="/quote-setup">All businesses</a></nav><h1>${esc(title)}</h1>
${body}</main></body></html>`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** Compares in constant time, so response timing can't reveal the password letter by letter. */
function samePassword(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

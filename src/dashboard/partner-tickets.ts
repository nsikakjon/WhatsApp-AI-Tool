import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../core/money.js";
import { createSupabaseCatalogue } from "../products/quote/catalogue.js";
import { nairaToKobo, type PriceListItem } from "../products/quote/pricelist.js";
import { createSupabaseSetup } from "../products/quote/store.js";
import { createSupabaseTicketStore } from "../products/quote/tickets/store.js";
import { esc } from "./page.js";

// Tickets for a partner's shop, set up from the dashboard's partner package:
// each ticket type is a row on the shop's price list ("TEDxUNIUYO 2026:
// Regular" at ₦3,000), marked as a ticket so every one paid for gets its own
// QR code (docs/EVENT_TICKETS.md), with how many are on sale (stock) and a
// picture. Prices are saved to the price list like the owner's own, so the
// bot still quotes them from the database, never from the AI.

export const TICKET_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface TicketRow {
  productId: string;
  variantId: string;
  /** The event, e.g. "TEDxUNIUYO 2026" (the price list's product). */
  event: string;
  /** e.g. "VIP" (the price list's option). */
  type: string;
  priceKobo: number | null;
  /** How many are left on sale. Null = no cap. */
  left: number | null;
  ticket: boolean;
  photo: boolean;
  sold: number;
  checkedIn: number;
}

export interface TicketInput {
  event: string;
  type: string;
  priceKobo: number;
  /** How many are on sale. Null = no cap. */
  onSale: number | null;
  photo: { data: Uint8Array; mimeType: string } | null;
}

export interface TicketAdmin {
  /** The shop's whole price list, tickets first. */
  rows(): Promise<TicketRow[]>;
  /** Adds the ticket type, or changes its price, number on sale and picture. Returns a problem, or null. */
  save(input: TicketInput): Promise<string | null>;
  /** Marks every row of a product as a ticket, or not. */
  mark(productId: string, ticket: boolean): Promise<void>;
  /** Takes a row off the price list. Returns a problem, or null. */
  remove(variantId: string): Promise<string | null>;
}

const field = (form: Record<string, unknown>, name: string, max = 80) => {
  const value = form[name];
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
};

export async function parseTicketForm(form: Record<string, unknown>): Promise<TicketInput | { problem: string }> {
  const event = field(form, "event");
  if (!event) return { problem: "Type the event's name, e.g. TEDxUNIUYO 2026." };
  if (event.includes(":")) return { problem: "Leave the colon out of the event's name." };
  const type = field(form, "type", 60) || "Regular";
  const priceKobo = nairaToKobo(field(form, "price", 20));
  if (priceKobo === null || priceKobo < 100) return { problem: "Type the ticket's price in naira, e.g. 3000." };
  const onSaleText = field(form, "on_sale", 9).replace(/,/g, "");
  if (onSaleText && !/^\d{1,6}$/.test(onSaleText)) return { problem: "How many are on sale should be a whole number, or empty for no limit." };
  let photo: TicketInput["photo"] = null;
  const file = form.photo;
  if (file instanceof File && file.size > 0) {
    if (!PHOTO_TYPES.includes(file.type)) return { problem: "The picture should be a JPEG, PNG or WebP image." };
    if (file.size > TICKET_PHOTO_MAX_BYTES) return { problem: "The picture is over 5 MB. Please use a smaller one." };
    photo = { data: new Uint8Array(await file.arrayBuffer()), mimeType: file.type };
  }
  return { event, type, priceKobo, onSale: onSaleText ? Number(onSaleText) : null, photo };
}

export function renderTickets(partnerId: number, rows: TicketRow[] | "error"): string {
  if (rows === "error") return `<p class="problem">Couldn't read their price list just now.</p>`;
  const base = `/dashboard/partners/${partnerId}/tickets`;
  const lines = rows
    .map((r) => {
      const toggle = `<form method="post" action="${base}/${esc(r.productId)}/${r.ticket ? "off" : "on"}"><button class="link" type="submit">${r.ticket ? "Not a ticket" : "Make it a ticket"}</button></form>`;
      const remove = `<form method="post" action="${base}/row/${esc(r.variantId)}/remove" onsubmit="return confirm('Take ${esc(
        `${r.event}: ${r.type}`.replace(/['\\]/g, ""),
      )} off their price list?')"><button class="link" type="submit">Remove</button></form>`;
      return `<tr${r.ticket ? ' class="is-ticket"' : ""}><td>${esc(r.event)}: <b>${esc(r.type)}</b>${r.ticket ? ' <span class="state st-on">Ticket</span>' : ""}${
        r.photo ? "" : '<span class="small">No picture yet</span>'
      }</td><td>${r.priceKobo === null ? "Priced on request" : esc(formatNaira(r.priceKobo))}</td><td>${r.left === null ? "No limit" : esc(String(r.left))}</td><td>${
        r.ticket ? `${r.sold} / ${r.checkedIn}` : ""
      }</td><td class="acts">${toggle}${remove}</td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table class="plans wide tickets"><thead><tr><th>On their price list</th><th>Price</th><th>Left on sale</th><th>Sold / in</th><th></th></tr></thead><tbody>${
    lines || `<tr><td colspan="5">Nothing on their price list yet.</td></tr>`
  }</tbody></table></div>
<form class="entry" method="post" action="${base}" enctype="multipart/form-data">
<h3>Add a ticket type</h3>
<p class="small wide-all">Typing a type that's already there changes its price, number on sale and picture. The picture shows for every type of the same event.</p>
<label>Event <input name="event" required maxlength="80" placeholder="e.g. TEDxUNIUYO 2026" autocomplete="off"></label>
<label>Type <input name="type" maxlength="60" placeholder="e.g. Regular, VIP, Student" autocomplete="off"></label>
<label>Price (₦) <input name="price" required inputmode="numeric" maxlength="20" placeholder="e.g. 3000"></label>
<label>How many on sale <input name="on_sale" type="number" min="0" placeholder="Empty = no limit"></label>
<label class="wide">Picture <input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
<div class="buttons"><button type="submit">Save ticket type</button></div>
</form>`;
}

export const TICKETS_CSS = `.tickets { min-width:640px; }
.tickets td { vertical-align:top; }
.tickets .acts { white-space:nowrap; }
.tickets .acts form { display:inline; margin-left:10px; }
.tickets tr.is-ticket td:first-child { box-shadow:inset 3px 0 0 var(--lime); }
.package input[type=file] { color:var(--muted); }`;

export function createSupabaseTicketAdmin(db: SupabaseClient, businessId: string): TicketAdmin {
  const setup = createSupabaseSetup(db);
  const catalogue = createSupabaseCatalogue(db, businessId);
  const tickets = createSupabaseTicketStore(db, businessId);
  const key = (product: string, option: string) => `${product}: ${option}`.toLowerCase();

  return {
    async rows() {
      const [list, items, products, counts] = await Promise.all([
        setup.priceList(businessId),
        catalogue.items(),
        tickets.products(),
        tickets.counts(new Date(0)),
      ]);
      const price = new Map(list.map((i) => [key(i.product, i.option), i.tiers[0]?.unitPriceKobo ?? null]));
      const isTicket = new Map(products.map((p) => [p.id, p.ticket]));
      const count = new Map(counts.map((c) => [c.name.toLowerCase(), c]));
      return items
        .map((i) => {
          const type = i.name.slice(i.productName.length + 2);
          return {
            productId: i.productId,
            variantId: i.variantId,
            event: i.productName,
            type,
            priceKobo: price.get(key(i.productName, type)) ?? null,
            left: i.stock,
            ticket: isTicket.get(i.productId) ?? false,
            photo: Boolean(i.photoPath),
            sold: count.get(i.name.toLowerCase())?.sold ?? 0,
            checkedIn: count.get(i.name.toLowerCase())?.checkedIn ?? 0,
          };
        })
        .sort((a, b) => Number(b.ticket) - Number(a.ticket) || a.event.localeCompare(b.event) || a.type.localeCompare(b.type));
    },

    async save(t) {
      const list = await setup.priceList(businessId);
      const row: PriceListItem = { product: t.event, option: t.type, minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: t.priceKobo }] };
      const at = list.findIndex((i) => key(i.product, i.option) === key(t.event, t.type));
      if (at >= 0) list[at] = { ...list[at]!, minQuantity: 1, tiers: row.tiers };
      else list.push(row);
      await setup.replacePriceList(businessId, list);

      const saved = (await catalogue.items()).find((i) => i.name.toLowerCase() === key(t.event, t.type));
      if (!saved) return "Saved the price, but couldn't find the new row to finish setting it up. Please try again.";
      await tickets.setTicket(saved.productId, true);
      await catalogue.setStock(saved.variantId, t.onSale);
      if (t.photo) await catalogue.savePhoto(saved.productId, t.photo.data, t.photo.mimeType);
      return null;
    },

    mark: (productId, ticket) => tickets.setTicket(productId, ticket),

    async remove(variantId) {
      const item = (await catalogue.items()).find((i) => i.variantId === variantId);
      if (!item) return null;
      const list = await setup.priceList(businessId);
      const rest = list.filter((i) => key(i.product, i.option) !== item.name.toLowerCase());
      if (!rest.length) return "That's the only thing on their price list, so it can't be removed. Add the right ticket type first.";
      await setup.replacePriceList(businessId, rest);
      return null;
    },
  };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { Hono } from "hono";
import QRCode from "qrcode";
import { formatMoney, type Currency } from "../../../core/money.js";
import { A4, jpegsToPdf } from "../../../core/pdf.js";
import { showWaId } from "../../../core/whatsapp/ids.js";
import { hireCharge } from "./charges.js";
import { daysBetween, showDay } from "./dates.js";
import type { Booking } from "./store.js";

// Printable hire papers, as A4 PDFs behind signed links the owner gets on
// WhatsApp:
//   agreement  the hire agreement the customer signs when it goes out
//   checklist  the delivery and return checklist, one block per item
//   stickers   a QR sticker per hire item: scanning it opens WhatsApp with
//              "I'd like to hire the <item>" typed in
// KahnPrints can print them on sticker paper or as pads.

export type PaperKind = "agreement" | "checklist" | "stickers";

const UUID = /^[0-9a-f-]{36}$/;

function sign(secret: string, what: string): string {
  return createHmac("sha256", secret).update(what).digest("base64url").slice(0, 24);
}

export interface HirePapers {
  agreementLink(orderId: string): string;
  checklistLink(orderId: string): string;
  stickersLink(): string;
}

export function createHirePaperLinks(secret: string, publicUrl: string, businessId: string): HirePapers {
  const base = publicUrl.replace(/\/+$/, "");
  const link = (kind: PaperKind, id: string) => `${base}/hire/${businessId}.${kind}.${id}.${sign(secret, `hire:${businessId}:${kind}:${id}`)}.pdf`;
  return {
    agreementLink: (orderId) => link("agreement", orderId),
    checklistLink: (orderId) => link("checklist", orderId),
    stickersLink: () => link("stickers", businessId),
  };
}

export function readHirePaperToken(secret: string, token: string): { businessId: string; kind: PaperKind; id: string } | null {
  const [businessId, kind, id, sig] = token.replace(/\.pdf$/, "").split(".");
  if (!businessId || !kind || !id || !sig || !UUID.test(businessId) || !UUID.test(id)) return null;
  if (kind !== "agreement" && kind !== "checklist" && kind !== "stickers") return null;
  const expected = Buffer.from(sign(secret, `hire:${businessId}:${kind}:${id}`));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? { businessId, kind, id } : null;
}

// ---- Drawing ----

const W = 1240;
const H = 1754;
const M = 90;
const INK = "#111827";
const MUTED = "#4b5563";
const LINE = "#d1d5db";
const fontDir = fileURLToPath(new URL("../../../../assets/fonts/", import.meta.url));
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  GlobalFonts.registerFromPath(`${fontDir}Inter-Regular.otf`, "Inter");
  GlobalFonts.registerFromPath(`${fontDir}Inter-SemiBold.otf`, "Inter SemiBold");
  GlobalFonts.registerFromPath(`${fontDir}Inter-ExtraBold.otf`, "Inter ExtraBold");
  fontsLoaded = true;
}

/** Splits text into lines no wider than `width`. */
function wrap(ctx: SKRSContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function page(): { ctx: SKRSContext2D; done: () => Uint8Array } {
  loadFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";
  return { ctx, done: () => new Uint8Array(canvas.toBuffer("image/jpeg", 90)) };
}

function pdf(pages: Uint8Array[]): Uint8Array {
  return jpegsToPdf(pages.map((jpeg) => ({ jpeg, widthPx: W, heightPx: H, widthPt: A4.portrait.w, heightPt: A4.portrait.h })));
}

function header(ctx: SKRSContext2D, business: PaperBusiness, title: string, ref: string | null): number {
  ctx.fillStyle = INK;
  ctx.font = "44px Inter ExtraBold";
  ctx.fillText(business.name, M, M);
  let y = M + 60;
  if (business.details) {
    ctx.font = "24px Inter";
    ctx.fillStyle = MUTED;
    for (const l of wrap(ctx, business.details, W - 2 * M).slice(0, 2)) {
      ctx.fillText(l, M, y);
      y += 32;
    }
  }
  y += 20;
  ctx.fillStyle = INK;
  ctx.font = "36px Inter SemiBold";
  ctx.fillText(title, M, y);
  if (ref) {
    ctx.textAlign = "right";
    ctx.fillText(ref, W - M, y);
    ctx.textAlign = "left";
  }
  y += 56;
  ctx.fillStyle = INK;
  ctx.fillRect(M, y, W - 2 * M, 3);
  return y + 28;
}

function signLine(ctx: SKRSContext2D, label: string, x: number, y: number, width: number) {
  ctx.fillStyle = LINE;
  ctx.fillRect(x, y + 50, width, 2);
  ctx.fillStyle = MUTED;
  ctx.font = "22px Inter";
  ctx.fillText(label, x, y + 60);
}

export interface PaperBusiness {
  name: string;
  /** Address or phone, as on invoices. */
  details: string | null;
  orderPrefix: string;
  currency: Currency;
}

const TERMS = (business: string) => [
  `Everything hired stays the property of ${business}. Don't lend, sublet or move it from the delivery address without our written OK.`,
  "From the moment it is delivered or collected until it is returned, you are responsible for it, including loss, theft and damage beyond fair wear and tear.",
  "Return it on the return date above. Each late day is charged at the daily rate and taken from the deposit.",
  "Damage, missing parts and heavy cleaning are charged at cost and taken from the deposit. If they cost more than the deposit, you pay the difference.",
  "If it breaks down, stop using it and tell us on WhatsApp straight away. Don't repair it yourself.",
  "Fuel, oil and other consumables are yours to provide unless we agreed otherwise in writing.",
  "Your deposit comes back after the returns check, less anything above.",
];

/** The hire agreement for one order's bookings. */
export function agreementPdf(business: PaperBusiness, bookings: Booking[]): Uint8Array {
  const money = (k: number) => formatMoney(k, business.currency);
  const first = bookings[0]!;
  const { ctx, done } = page();
  let y = header(ctx, business, "Hire agreement", `${business.orderPrefix}-${first.orderNumber}`);
  ctx.font = "26px Inter";
  ctx.fillStyle = INK;
  ctx.fillText(`Customer: ${first.customerName ?? "________________________"}`, M, y);
  ctx.fillText(`WhatsApp: ${showWaId(first.customerWaId)}`, W / 2, y);
  y += 44;
  ctx.fillText("ID type and number: ______________________________", M, y);
  y += 44;
  ctx.fillText("Delivery or site address: _______________________________________________", M, y);
  y += 64;

  const cols = { item: M, units: M + 600, charge: W - M - 230, deposit: W - M };
  ctx.font = "22px Inter SemiBold";
  ctx.fillStyle = MUTED;
  ctx.fillText("ITEM AND DATES", cols.item, y);
  ctx.fillText("QTY", cols.units, y);
  ctx.textAlign = "right";
  ctx.fillText("HIRE", cols.charge, y);
  ctx.fillText("DEPOSIT", cols.deposit, y);
  ctx.textAlign = "left";
  y += 36;
  ctx.fillStyle = LINE;
  ctx.fillRect(M, y, W - 2 * M, 2);
  y += 16;
  let hireTotal = 0;
  let depositTotal = 0;
  ctx.font = "24px Inter";
  for (const b of bookings) {
    const days = daysBetween(b.start, b.back);
    const charge = hireCharge(days, { dailyKobo: b.dailyKobo, weeklyKobo: b.weeklyKobo }) * b.units;
    hireTotal += charge;
    depositTotal += b.depositKobo * b.units;
    ctx.fillStyle = INK;
    ctx.fillText(wrap(ctx, b.name, cols.units - cols.item - 30)[0]!, cols.item, y);
    ctx.fillText(String(b.units), cols.units, y);
    ctx.textAlign = "right";
    ctx.fillText(money(charge), cols.charge, y);
    ctx.fillText(money(b.depositKobo * b.units), cols.deposit, y);
    ctx.textAlign = "left";
    y += 32;
    ctx.fillStyle = MUTED;
    ctx.font = "20px Inter";
    ctx.fillText(`Out ${showDay(b.start)}, back ${showDay(b.back)} · ${days} day${days === 1 ? "" : "s"} · ${money(b.dailyKobo)} a day${b.weeklyKobo !== null ? ` · ${money(b.weeklyKobo)} a week` : ""}`, cols.item, y);
    ctx.font = "24px Inter";
    y += 44;
  }
  ctx.fillStyle = LINE;
  ctx.fillRect(M, y, W - 2 * M, 2);
  y += 18;
  ctx.font = "26px Inter SemiBold";
  ctx.fillStyle = INK;
  ctx.fillText("Totals (delivery, if any, is on the invoice)", M, y);
  ctx.textAlign = "right";
  ctx.fillText(money(hireTotal), cols.charge, y);
  ctx.fillText(money(depositTotal), cols.deposit, y);
  ctx.textAlign = "left";
  y += 70;

  ctx.font = "28px Inter SemiBold";
  ctx.fillText("Terms", M, y);
  y += 46;
  ctx.font = "23px Inter";
  TERMS(business.name).forEach((term, i) => {
    const lines = wrap(ctx, term, W - 2 * M - 44);
    ctx.fillStyle = INK;
    ctx.fillText(`${i + 1}.`, M, y);
    for (const l of lines) {
      ctx.fillText(l, M + 44, y);
      y += 32;
    }
    y += 10;
  });
  y = Math.max(y + 30, H - M - 260);
  ctx.font = "24px Inter";
  ctx.fillStyle = INK;
  ctx.fillText("I have read these terms and received the items above in working order.", M, y);
  y += 40;
  const half = (W - 2 * M - 60) / 2;
  signLine(ctx, "Customer's signature and date", M, y, half);
  signLine(ctx, `For ${business.name}: name, signature and date`, M + half + 60, y, half);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "18px Inter";
  ctx.fillText("Made with yarnOga", M, H - M + 20);
  return pdf([done()]);
}

const CHECKS = ["Clean and in good condition", "Works when tested", "All parts and accessories there", "Meter or fuel reading (if any)", "Photos taken"];

/** A delivery and return checklist: per item, an Out column and a Back column. */
export function checklistPdf(business: PaperBusiness, bookings: Booking[]): Uint8Array {
  const pages: Uint8Array[] = [];
  const first = bookings[0]!;
  let current = page();
  let y = header(current.ctx, business, "Delivery and return checklist", `${business.orderPrefix}-${first.orderNumber}`);
  const block = 120 + CHECKS.length * 56 + 150;
  for (const b of bookings) {
    for (let unit = 1; unit <= b.units; unit++) {
      if (y + block > H - M) {
        pages.push(current.done());
        current = page();
        y = header(current.ctx, business, "Delivery and return checklist", `${business.orderPrefix}-${first.orderNumber}`);
      }
      const ctx = current.ctx;
      ctx.fillStyle = INK;
      ctx.font = "30px Inter SemiBold";
      ctx.fillText(`${b.name}${b.units > 1 ? ` (${unit} of ${b.units})` : ""}`, M, y);
      ctx.font = "22px Inter";
      ctx.fillStyle = MUTED;
      ctx.fillText(`Serial / fleet no: ______________    Out ${showDay(b.start)}, back ${showDay(b.back)}    ${first.customerName ?? showWaId(first.customerWaId)}`, M, y + 44);
      let row = y + 100;
      const outX = W - M - 330;
      const backX = W - M - 140;
      ctx.font = "22px Inter SemiBold";
      ctx.fillStyle = MUTED;
      ctx.fillText("OUT", outX, row);
      ctx.fillText("BACK", backX, row);
      row += 36;
      ctx.font = "24px Inter";
      for (const check of CHECKS) {
        ctx.fillStyle = INK;
        ctx.fillText(check, M, row + 8);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.strokeRect(outX, row, 36, 36);
        ctx.strokeRect(backX, row, 36, 36);
        row += 56;
      }
      ctx.fillText("Damage or missing parts: _____________________________________________", M, row + 8);
      row += 56;
      const third = (W - 2 * M - 80) / 3;
      signLine(ctx, "Customer (out)", M, row - 30, third);
      signLine(ctx, "Staff (out)", M + third + 40, row - 30, third);
      signLine(ctx, "Staff (back)", M + 2 * (third + 40), row - 30, third);
      y = row + 110;
    }
  }
  pages.push(current.done());
  return pdf(pages);
}

/** The chat link on an item's sticker: opens WhatsApp with the request typed in. */
export function hireChatLink(whatsappNumber: string, itemName: string): string {
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`I'd like to hire the ${itemName}`)}`;
}

/** QR stickers, eight to an A4 page. */
export async function stickersPdf(business: PaperBusiness, whatsappNumber: string, items: string[]): Promise<Uint8Array> {
  const pages: Uint8Array[] = [];
  const perPage = 8;
  const cw = (W - 2 * M) / 2;
  const ch = (H - 2 * M) / 4;
  for (let start = 0; start < Math.max(items.length, 1); start += perPage) {
    const { ctx, done } = page();
    for (const [i, name] of items.slice(start, start + perPage).entries()) {
      const x = M + (i % 2) * cw;
      const y = M + Math.floor(i / 2) * ch;
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.strokeRect(x + 10, y + 10, cw - 20, ch - 20);
      ctx.setLineDash([]);
      const qrSize = Math.min(ch - 100, 230);
      const qr = createCanvas(qrSize, qrSize);
      await QRCode.toCanvas(qr as unknown as HTMLCanvasElement, hireChatLink(whatsappNumber, name), { width: qrSize, margin: 1 });
      ctx.drawImage(qr, x + 40, y + (ch - qrSize) / 2, qrSize, qrSize);
      const tx = x + 60 + qrSize;
      const tw = cw - qrSize - 100;
      ctx.fillStyle = INK;
      ctx.font = "30px Inter ExtraBold";
      let ty = y + 60;
      for (const l of wrap(ctx, name, tw).slice(0, 3)) {
        ctx.fillText(l, tx, ty);
        ty += 38;
      }
      ctx.font = "22px Inter";
      ctx.fillStyle = MUTED;
      ty += 14;
      for (const l of wrap(ctx, "Scan to book this item on WhatsApp", tw)) {
        ctx.fillText(l, tx, ty);
        ty += 30;
      }
      ctx.font = "22px Inter SemiBold";
      ctx.fillStyle = INK;
      ctx.fillText(wrap(ctx, business.name, tw)[0]!, tx, Math.max(ty + 16, y + ch - 100));
      ctx.font = "20px Inter";
      ctx.fillText(showWaId(whatsappNumber), tx, Math.max(ty + 46, y + ch - 70));
    }
    pages.push(done());
  }
  return pdf(pages);
}

// ---- The links' page ----

export interface HirePaperDeps {
  secret: string;
  business(id: string): Promise<{
    paper: PaperBusiness;
    bookings(orderId: string): Promise<Booking[]>;
    /** Names of the hire items, for stickers. */
    itemNames(): Promise<string[]>;
    /** The number customers message (digits), for stickers. */
    whatsappNumber(): Promise<string | null>;
  } | null>;
}

export function createHirePapers(deps: HirePaperDeps): Hono {
  const app = new Hono();
  app.get("/hire/:token", async (c) => {
    const token = readHirePaperToken(deps.secret, c.req.param("token"));
    if (!token) return c.notFound();
    const biz = await deps.business(token.businessId);
    if (!biz) return c.notFound();
    let file: Uint8Array;
    let name: string;
    if (token.kind === "stickers") {
      const [number, items] = await Promise.all([biz.whatsappNumber(), biz.itemNames()]);
      if (!number || !items.length) return c.text("No hire items or WhatsApp number yet.", 404);
      file = await stickersPdf(biz.paper, number, items);
      name = "hire-stickers.pdf";
    } else {
      const bookings = await biz.bookings(token.id);
      if (!bookings.length) return c.notFound();
      const ref = `${biz.paper.orderPrefix}-${bookings[0]!.orderNumber}`;
      file = token.kind === "agreement" ? agreementPdf(biz.paper, bookings) : checklistPdf(biz.paper, bookings);
      name = `${ref}-${token.kind}.pdf`;
    }
    return c.body(file as unknown as ArrayBuffer, 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
    });
  });
  return app;
}

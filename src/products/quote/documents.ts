// Draws invoices and receipts as pictures, with the business logo at the top,
// so they can be sent straight into the WhatsApp chat.
// Pure drawing code: every amount comes in already worked out (in kobo) from
// the saved order, so nothing here calculates a price.
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import QRCode from "qrcode";
import type { Lang } from "../../core/i18n.js";
import { formatMoney, type Currency } from "../../core/money.js";
import type { QuoteLine } from "./pricing.js";
import { isPhoneNumber } from "../../core/whatsapp/ids.js";

const fontDir = fileURLToPath(new URL("../../../assets/fonts/", import.meta.url));
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  // Inter, because it has the naira sign (₦); the flyer fonts don't.
  GlobalFonts.registerFromPath(`${fontDir}Inter-Regular.otf`, "Inter");
  GlobalFonts.registerFromPath(`${fontDir}Inter-SemiBold.otf`, "Inter SemiBold");
  GlobalFonts.registerFromPath(`${fontDir}Inter-ExtraBold.otf`, "Inter ExtraBold");
  fontsLoaded = true;
}

export interface DocumentInput {
  kind: "invoice" | "receipt";
  businessName: string;
  /** The business logo (PNG, JPEG or WebP). Without one, the name stands alone. */
  logo?: Uint8Array;
  /** Address, phone or email printed under the business name. */
  businessDetails?: string;
  /** e.g. KP-1001 */
  ref: string;
  /** The invoice date, or the payment date on a receipt. */
  date: Date;
  customerName?: string;
  /** Digits only, e.g. 2348012345678. */
  customerWaId: string;
  lines: QuoteLine[];
  /** A discount code, as its own line taken off the items. Already taken off totalKobo. */
  discount?: { code: string; amountKobo: number };
  /** The delivery fee, as its own line. Already included in totalKobo. */
  delivery?: { label: string; feeKobo: number };
  totalKobo: number;
  /** Bank details printed on invoices so the customer knows where to pay. */
  paymentDetails?: string;
  /** On walk-in receipts: the QR code staff scan to hand the order over, and the code they can type instead. */
  pickup?: Pickup;
  /** The words on the document (default English). */
  lang?: Lang;
  /** The money on it (default naira). */
  currency?: Currency;
}

/** The fixed words on invoices and receipts. */
const WORDS = {
  en: {
    invoice: "INVOICE", receipt: "RECEIPT", no: "No.", date: "Date", paidOn: "Paid on", billTo: "BILL TO", receivedFrom: "RECEIVED FROM",
    customer: "Customer", item: "ITEM", qty: "QTY", unit: "UNIT PRICE", amount: "AMOUNT", totalDue: "TOTAL DUE", amountPaid: "AMOUNT PAID",
    paid: "PAID", awaiting: "AWAITING PAYMENT", howToPay: "HOW TO PAY", showWhenCollect: "SHOW THIS WHEN YOU COLLECT", forTable: "For",
    collectAt: "Collect at:", codeOnce: "Each code works once.", quoteRef: (ref: string) => `Please quote ${ref} when you pay. Thank you!`,
    thanks: "Thank you for your business!", discount: "Discount",
  },
  fr: {
    invoice: "FACTURE", receipt: "REÇU", no: "N°", date: "Date", paidOn: "Payé le", billTo: "FACTURÉ À", receivedFrom: "REÇU DE",
    customer: "Client", item: "ARTICLE", qty: "QTÉ", unit: "PRIX UNITAIRE", amount: "MONTANT", totalDue: "TOTAL À PAYER", amountPaid: "MONTANT PAYÉ",
    paid: "PAYÉ", awaiting: "EN ATTENTE DE PAIEMENT", howToPay: "COMMENT PAYER", showWhenCollect: "À MONTRER AU RETRAIT", forTable: "Pour",
    collectAt: "Retrait à :", codeOnce: "Chaque code ne sert qu'une fois.", quoteRef: (ref: string) => `Merci d'indiquer ${ref} lors du paiement.`,
    thanks: "Merci de votre confiance !", discount: "Remise",
  },
};

export interface Pickup {
  /** What the QR code holds: the order's pickup page link. */
  qrText: string;
  /** e.g. "EH-214 · 4827" */
  code: string;
  /** e.g. "Table 7", when the customer said where they are. */
  table?: string;
  /** The screens that make it, e.g. ["Bar", "Kitchen"]. */
  stations: string[];
}

// A4 shape, wide enough to read on a phone.
const WIDTH = 1240;
const MIN_HEIGHT = 1500;
const MARGIN = 90;

const INK = "#1f2933";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";
const SHADE = "#f3f4f6";
const GREEN = "#15803d";
const AMBER = "#b45309";

/** Formats a date, e.g. 14 Oct 2026 (or 14 oct. 2026 in French), in West African time. */
export function formatDocDate(date: Date, lang: Lang = "en"): string {
  return date.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

export async function renderDocument(input: DocumentInput): Promise<Buffer> {
  loadFonts();
  const w = WORDS[input.lang ?? "en"];
  const money = (minor: number) => formatMoney(minor, input.currency ?? "NGN");
  let logo: Image | undefined;
  if (input.logo) {
    try {
      logo = await loadImage(Buffer.from(input.logo));
    } catch {
      logo = undefined; // An unreadable logo shouldn't stop the invoice.
    }
  }

  // Measure the item rows first, so a long order makes a taller page.
  const scratch = createCanvas(10, 10).getContext("2d");
  const cols = { item: MARGIN + 24, qty: 640, unit: 880, amount: WIDTH - MARGIN - 24 };
  scratch.font = "30px Inter";
  const items: Array<{ name: string; quantity: number | null; unitPriceKobo: number | null; totalKobo: number; minus?: boolean }> = [
    ...input.lines,
    ...(input.discount ? [{ name: `${w.discount} (${input.discount.code})`, quantity: null, unitPriceKobo: null, totalKobo: input.discount.amountKobo, minus: true }] : []),
    ...(input.delivery ? [{ name: input.delivery.label, quantity: null, unitPriceKobo: null, totalKobo: input.delivery.feeKobo }] : []),
  ];
  const rows = items.map((l) => wrap(scratch, l.name, cols.qty - cols.item - 60));
  const rowsHeight = rows.reduce((h, r) => h + r.length * 42 + 30, 0);
  const notes = input.kind === "invoice" && input.paymentDetails ? input.paymentDetails : "";
  scratch.font = "28px Inter";
  const noteLines = notes ? notes.split("\n").flatMap((p) => wrap(scratch, p, WIDTH - 2 * MARGIN - 48)) : [];
  const pickup = input.kind === "receipt" ? input.pickup : undefined;
  const height = Math.max(MIN_HEIGHT, 900 + rowsHeight + (noteLines.length ? 120 + noteLines.length * 40 : 0) + (pickup ? PICKUP_HEIGHT + 100 : 0));

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);
  const accent = input.kind === "receipt" ? GREEN : INK;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, WIDTH, 16);

  // Header: logo and business on the left, document title on the right.
  let y = 90;
  let nameX = MARGIN;
  if (logo) {
    const box = 170;
    const scale = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    ctx.drawImage(logo, MARGIN, y + (box - h) / 2, w, h);
    nameX = MARGIN + w + 36;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = INK;
  ctx.font = "44px Inter ExtraBold";
  const nameWidth = 640 - (nameX - MARGIN);
  const nameLines = wrap(ctx, input.businessName, nameWidth).slice(0, 2);
  let ny = y + (logo ? 20 : 0);
  for (const line of nameLines) {
    ctx.fillText(line, nameX, ny);
    ny += 56;
  }
  if (input.businessDetails) {
    ctx.font = "24px Inter";
    ctx.fillStyle = MUTED;
    for (const line of input.businessDetails.split("\n").flatMap((p) => wrap(ctx, p, nameWidth)).slice(0, 3)) {
      ctx.fillText(line, nameX, ny + 4);
      ny += 34;
    }
  }

  ctx.textAlign = "right";
  ctx.fillStyle = accent;
  ctx.font = "64px Inter ExtraBold";
  ctx.fillText(input.kind === "invoice" ? w.invoice : w.receipt, WIDTH - MARGIN, y);
  ctx.font = "28px Inter";
  ctx.fillStyle = MUTED;
  ctx.fillText(`${w.no} ${input.ref}`, WIDTH - MARGIN, y + 92);
  // French puts a space before a colon.
  const colon = input.lang === "fr" ? " :" : ":";
  ctx.fillText(`${input.kind === "invoice" ? w.date : w.paidOn}${colon} ${formatDocDate(input.date, input.lang)}`, WIDTH - MARGIN, y + 132);

  // Who it's for.
  y = Math.max(ny, y + 200) + 50;
  ctx.fillStyle = RULE;
  ctx.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, 2);
  y += 40;
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = "24px Inter SemiBold";
  ctx.fillText(input.kind === "invoice" ? w.billTo : w.receivedFrom, MARGIN, y);
  ctx.fillStyle = INK;
  ctx.font = "32px Inter SemiBold";
  ctx.fillText(input.customerName?.trim() || w.customer, MARGIN, y + 38);
  ctx.font = "28px Inter";
  ctx.fillStyle = MUTED;
  if (isPhoneNumber(input.customerWaId)) ctx.fillText(`+${input.customerWaId}`, MARGIN, y + 84);

  // Items table.
  y += 160;
  ctx.fillStyle = SHADE;
  ctx.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, 64);
  ctx.fillStyle = MUTED;
  ctx.font = "24px Inter SemiBold";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(w.item, cols.item, y + 32);
  ctx.textAlign = "right";
  ctx.fillText(w.qty, cols.qty, y + 32);
  ctx.fillText(w.unit, cols.unit, y + 32);
  ctx.fillText(w.amount, cols.amount, y + 32);
  ctx.textBaseline = "top";
  y += 64 + 20;

  items.forEach((l, i) => {
    const nameRows = rows[i]!;
    ctx.fillStyle = INK;
    ctx.font = "30px Inter";
    ctx.textAlign = "left";
    nameRows.forEach((r, j) => ctx.fillText(r, cols.item, y + j * 42));
    ctx.textAlign = "right";
    if (l.quantity !== null) ctx.fillText(l.quantity.toLocaleString(input.lang === "fr" ? "fr-FR" : "en-NG"), cols.qty, y);
    if (l.unitPriceKobo !== null) ctx.fillText(money(l.unitPriceKobo), cols.unit, y);
    ctx.font = "30px Inter SemiBold";
    ctx.fillText(`${l.minus ? "-" : ""}${money(l.totalKobo)}`, cols.amount, y);
    y += nameRows.length * 42 + 10;
    ctx.fillStyle = RULE;
    ctx.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, 2);
    y += 20;
  });

  // Total.
  y += 20;
  ctx.textAlign = "right";
  const label = input.kind === "invoice" ? w.totalDue : w.amountPaid;
  const total = money(input.totalKobo);
  ctx.font = "48px Inter ExtraBold";
  const totalWidth = ctx.measureText(total).width;
  ctx.fillStyle = accent;
  ctx.fillText(total, cols.amount, y);
  ctx.font = "28px Inter SemiBold";
  ctx.fillStyle = MUTED;
  ctx.fillText(label, cols.amount - totalWidth - 32, y + 14);
  y += 110;

  // Status stamp.
  ctx.textAlign = "left";
  const stamp = input.kind === "receipt" ? w.paid : w.awaiting;
  ctx.font = "30px Inter ExtraBold";
  const stampW = ctx.measureText(stamp).width + 56;
  ctx.strokeStyle = input.kind === "receipt" ? GREEN : AMBER;
  ctx.lineWidth = 4;
  ctx.strokeRect(MARGIN, y, stampW, 64);
  ctx.fillStyle = input.kind === "receipt" ? GREEN : AMBER;
  ctx.textBaseline = "middle";
  ctx.fillText(stamp, MARGIN + 28, y + 33);
  ctx.textBaseline = "top";
  y += 120;

  if (pickup) {
    drawPickup(ctx, pickup, y, w);
    y += PICKUP_HEIGHT;
  }

  if (noteLines.length) {
    ctx.fillStyle = SHADE;
    ctx.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, 80 + noteLines.length * 40);
    ctx.fillStyle = MUTED;
    ctx.font = "24px Inter SemiBold";
    ctx.fillText(w.howToPay, MARGIN + 24, y + 24);
    ctx.fillStyle = INK;
    ctx.font = "28px Inter";
    noteLines.forEach((line, i) => ctx.fillText(line, MARGIN + 24, y + 64 + i * 40));
  }

  // Footer.
  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = "26px Inter";
  ctx.fillText(
    input.kind === "invoice" ? w.quoteRef(input.ref) : w.thanks,
    WIDTH / 2,
    height - 110,
  );

  return canvas.toBuffer("image/jpeg", 92);
}

const PICKUP_HEIGHT = 420;
const QR_SIZE = 320;

/** The collection box on a walk-in receipt: QR code on the left, the typed code and where to collect on the right. */
function drawPickup(ctx: SKRSContext2D, pickup: Pickup, top: number, w: (typeof WORDS)["en"]) {
  ctx.fillStyle = SHADE;
  ctx.fillRect(MARGIN, top, WIDTH - 2 * MARGIN, PICKUP_HEIGHT - 50);
  const qr = QRCode.create(pickup.qrText, { errorCorrectionLevel: "M" }).modules;
  const quiet = 4;
  const cell = Math.floor(QR_SIZE / (qr.size + 2 * quiet));
  const qrX = MARGIN + 25;
  const qrY = top + 25;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(qrX, qrY, cell * (qr.size + 2 * quiet), cell * (qr.size + 2 * quiet));
  ctx.fillStyle = "#000000";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.get(r, c)) ctx.fillRect(qrX + (c + quiet) * cell, qrY + (r + quiet) * cell, cell, cell);
    }
  }

  const x = qrX + QR_SIZE + 50;
  const textWidth = WIDTH - MARGIN - 24 - x;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = MUTED;
  ctx.font = "24px Inter SemiBold";
  ctx.fillText(w.showWhenCollect, x, top + 40);
  ctx.fillStyle = INK;
  ctx.font = "56px Inter ExtraBold";
  ctx.fillText(pickup.code, x, top + 80);
  ctx.font = "30px Inter";
  let y = top + 170;
  const lines = [
    ...(pickup.table ? [`${w.forTable} ${pickup.table}`] : []),
    ...(pickup.stations.length ? [`${w.collectAt} ${pickup.stations.join(", ")}`] : []),
    w.codeOnce,
  ];
  for (const line of lines.flatMap((l) => wrap(ctx, l, textWidth))) {
    ctx.fillText(line, x, y);
    y += 42;
  }
}

/** Splits text into lines that fit `maxWidth` in the current font. */
function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// Draws invoices and receipts as pictures, with the business logo at the top,
// so they can be sent straight into the WhatsApp chat.
// Pure drawing code: every amount comes in already worked out (in kobo) from
// the saved order, so nothing here calculates a price.
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { formatNaira } from "../../core/money.js";
import type { QuoteLine } from "./pricing.js";

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
  totalKobo: number;
  /** Bank details printed on invoices so the customer knows where to pay. */
  paymentDetails?: string;
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

/** Formats a date the way people write it in Nigeria, e.g. 14 Oct 2026 (Lagos time). */
export function formatDocDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

export async function renderDocument(input: DocumentInput): Promise<Buffer> {
  loadFonts();
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
  const rows = input.lines.map((l) => wrap(scratch, l.name, cols.qty - cols.item - 60));
  const rowsHeight = rows.reduce((h, r) => h + r.length * 42 + 30, 0);
  const notes = input.kind === "invoice" && input.paymentDetails ? input.paymentDetails : "";
  scratch.font = "28px Inter";
  const noteLines = notes ? notes.split("\n").flatMap((p) => wrap(scratch, p, WIDTH - 2 * MARGIN - 48)) : [];
  const height = Math.max(MIN_HEIGHT, 900 + rowsHeight + (noteLines.length ? 120 + noteLines.length * 40 : 0));

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
  ctx.fillText(input.kind === "invoice" ? "INVOICE" : "RECEIPT", WIDTH - MARGIN, y);
  ctx.font = "28px Inter";
  ctx.fillStyle = MUTED;
  ctx.fillText(`No. ${input.ref}`, WIDTH - MARGIN, y + 92);
  ctx.fillText(`${input.kind === "invoice" ? "Date" : "Paid on"}: ${formatDocDate(input.date)}`, WIDTH - MARGIN, y + 132);

  // Who it's for.
  y = Math.max(ny, y + 200) + 50;
  ctx.fillStyle = RULE;
  ctx.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, 2);
  y += 40;
  ctx.textAlign = "left";
  ctx.fillStyle = MUTED;
  ctx.font = "24px Inter SemiBold";
  ctx.fillText(input.kind === "invoice" ? "BILL TO" : "RECEIVED FROM", MARGIN, y);
  ctx.fillStyle = INK;
  ctx.font = "32px Inter SemiBold";
  ctx.fillText(input.customerName?.trim() || "Customer", MARGIN, y + 38);
  ctx.font = "28px Inter";
  ctx.fillStyle = MUTED;
  ctx.fillText(`+${input.customerWaId}`, MARGIN, y + 84);

  // Items table.
  y += 160;
  ctx.fillStyle = SHADE;
  ctx.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, 64);
  ctx.fillStyle = MUTED;
  ctx.font = "24px Inter SemiBold";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("ITEM", cols.item, y + 32);
  ctx.textAlign = "right";
  ctx.fillText("QTY", cols.qty, y + 32);
  ctx.fillText("UNIT PRICE", cols.unit, y + 32);
  ctx.fillText("AMOUNT", cols.amount, y + 32);
  ctx.textBaseline = "top";
  y += 64 + 20;

  input.lines.forEach((l, i) => {
    const nameRows = rows[i]!;
    ctx.fillStyle = INK;
    ctx.font = "30px Inter";
    ctx.textAlign = "left";
    nameRows.forEach((r, j) => ctx.fillText(r, cols.item, y + j * 42));
    ctx.textAlign = "right";
    ctx.fillText(l.quantity.toLocaleString("en-NG"), cols.qty, y);
    ctx.fillText(formatNaira(l.unitPriceKobo), cols.unit, y);
    ctx.font = "30px Inter SemiBold";
    ctx.fillText(formatNaira(l.totalKobo), cols.amount, y);
    y += nameRows.length * 42 + 10;
    ctx.fillStyle = RULE;
    ctx.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, 2);
    y += 20;
  });

  // Total.
  y += 20;
  ctx.textAlign = "right";
  const label = input.kind === "invoice" ? "TOTAL DUE" : "AMOUNT PAID";
  const total = formatNaira(input.totalKobo);
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
  const stamp = input.kind === "receipt" ? "PAID" : "AWAITING PAYMENT";
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

  if (noteLines.length) {
    ctx.fillStyle = SHADE;
    ctx.fillRect(MARGIN, y, WIDTH - 2 * MARGIN, 80 + noteLines.length * 40);
    ctx.fillStyle = MUTED;
    ctx.font = "24px Inter SemiBold";
    ctx.fillText("HOW TO PAY", MARGIN + 24, y + 24);
    ctx.fillStyle = INK;
    ctx.font = "28px Inter";
    noteLines.forEach((line, i) => ctx.fillText(line, MARGIN + 24, y + 64 + i * 40));
  }

  // Footer.
  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = "26px Inter";
  ctx.fillText(
    input.kind === "invoice" ? `Please quote ${input.ref} when you pay. Thank you!` : `Thank you for your business!`,
    WIDTH / 2,
    height - 110,
  );

  return canvas.toBuffer("image/jpeg", 92);
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

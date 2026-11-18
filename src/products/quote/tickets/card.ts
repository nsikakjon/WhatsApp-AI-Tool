import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { Lang } from "../../../core/i18n.js";
import { drawQr, loadFonts, wrap } from "../documents.js";

// Draws one event ticket as a picture for WhatsApp: the business, the ticket
// name, a big QR code for the door and the code to type if it won't scan.

export interface TicketCardInput {
  businessName: string;
  /** e.g. "Element House: VIP" */
  name: string;
  holderName: string | null;
  /** What the QR code holds: the ticket's signed link. */
  qrText: string;
  /** e.g. "EH-214 · 4827" */
  code: string;
  seat: number;
  of: number;
  lang?: Lang;
}

const WIDTH = 900;
const HEIGHT = 1300;
const MARGIN = 70;
const QR_SIZE = 560;
const INK = "#0c0d0d";
const PAPER = "#f3f4ef";
const ACCENT = "#c6ff1f";
const MUTED = "#6b6e69";

const WORDS = {
  en: { ticket: (n: number, of: number) => `Ticket ${n} of ${of}`, once: "Valid for one entry. Show this QR code at the door.", for: "For" },
  fr: { ticket: (n: number, of: number) => `Billet ${n} sur ${of}`, once: "Valable pour une entrée. Montrez ce code QR à l'entrée.", for: "Pour" },
};

export function renderTicketCard(input: TicketCardInput): Buffer {
  loadFonts();
  const w = WORDS[input.lang === "fr" ? "fr" : "en"];
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, WIDTH, 300);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = ACCENT;
  ctx.font = "30px Inter SemiBold";
  ctx.fillText(fit(ctx, input.businessName.toUpperCase(), WIDTH - 2 * MARGIN), MARGIN, 60);
  ctx.fillStyle = PAPER;
  ctx.font = "64px Inter ExtraBold";
  const nameLines = wrap(ctx, input.name, WIDTH - 2 * MARGIN).slice(0, 2);
  nameLines.forEach((line, i) => ctx.fillText(line, MARGIN, 115 + i * 76));

  const qrX = (WIDTH - QR_SIZE) / 2;
  drawQr(ctx, input.qrText, qrX, 350, QR_SIZE);

  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  ctx.font = "56px Inter ExtraBold";
  ctx.fillText(input.code, WIDTH / 2, 950);
  ctx.font = "34px Inter SemiBold";
  ctx.fillText(w.ticket(input.seat, input.of), WIDTH / 2, 1030);
  if (input.holderName) {
    ctx.fillStyle = MUTED;
    ctx.font = "30px Inter";
    ctx.fillText(fit(ctx, `${w.for} ${input.holderName}`, WIDTH - 2 * MARGIN), WIDTH / 2, 1085);
  }
  ctx.fillStyle = MUTED;
  ctx.font = "26px Inter";
  wrap(ctx, w.once, WIDTH - 2 * MARGIN).forEach((line, i) => ctx.fillText(line, WIDTH / 2, 1170 + i * 36));

  return canvas.toBuffer("image/jpeg", 92);
}

/** Cuts text with "…" so it fits on one line. */
function fit(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export interface TicketPosterInput {
  businessName: string;
  /** The event, e.g. "TEDxUNIUYO 28 Nov". */
  event: string;
  /** The ticket type, e.g. "VIP". */
  ticket: string;
  /** Already formatted from the price list, e.g. "₦5,000". */
  price: string;
}

const POSTER_WIDTH = 1200;
const POSTER_HEIGHT = 800;
/** WhatsApp may trim the edges of a card's picture, so everything sits well inside them. */
const POSTER_MARGIN = 110;

/** The picture on a ticket type's swipe card when its product has no photo: a ticket stub with the event, type and price. */
export function renderTicketPoster(input: TicketPosterInput): Buffer {
  loadFonts();
  const canvas = createCanvas(POSTER_WIDTH, POSTER_HEIGHT);
  const ctx = canvas.getContext("2d");
  const inner = POSTER_WIDTH - 2 * POSTER_MARGIN;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  // The notches and dashed tear line that make it read as a ticket.
  ctx.fillStyle = PAPER;
  for (const x of [0, POSTER_WIDTH]) {
    ctx.beginPath();
    ctx.arc(x, POSTER_HEIGHT * 0.68, 42, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = MUTED;
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 14]);
  ctx.beginPath();
  ctx.moveTo(70, POSTER_HEIGHT * 0.68);
  ctx.lineTo(POSTER_WIDTH - 70, POSTER_HEIGHT * 0.68);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = ACCENT;
  ctx.font = "34px Inter SemiBold";
  ctx.fillText(fit(ctx, input.businessName.toUpperCase(), inner), POSTER_MARGIN, 90);

  ctx.fillStyle = PAPER;
  ctx.font = "120px Inter ExtraBold";
  ctx.fillText(fit(ctx, input.ticket, inner), POSTER_MARGIN, 160);
  ctx.font = "46px Inter SemiBold";
  wrap(ctx, input.event, inner)
    .slice(0, 2)
    .forEach((line, i) => ctx.fillText(line, POSTER_MARGIN, 310 + i * 58));

  ctx.font = "64px Inter ExtraBold";
  const price = fit(ctx, input.price, inner - 80);
  const pill = ctx.measureText(price).width + 80;
  ctx.fillStyle = ACCENT;
  roundRect(ctx, POSTER_MARGIN, 600, pill, 110, 55);
  ctx.fillStyle = INK;
  ctx.fillText(price, POSTER_MARGIN + 40, 620);

  return canvas.toBuffer("image/jpeg", 90);
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

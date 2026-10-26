import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import QRCode from "qrcode";
import { A4, jpegsToPdf } from "../core/pdf.js";
import { showWaId } from "../core/whatsapp/ids.js";

// Posters for the shop counter, door or window: the business's name and logo,
// a big QR code that opens a WhatsApp chat with the bot, and the number.
// Portrait or landscape, A4 at 150 dots per inch (prints sharply on A4 or A3),
// as a PNG to share or a PDF to print. English or French.

export type Orientation = "portrait" | "landscape";
export type PosterLang = "en" | "fr";

export interface PosterInput {
  businessName: string;
  /** Digits, e.g. 2348012345678: the number customers message. */
  whatsappNumber: string;
  logo?: Uint8Array | null;
  /** What they sell, e.g. "Flyers, banners and branded shirts". Optional. */
  tagline?: string | null;
  /** Main colour, e.g. "#128c4a". */
  colour?: string;
  orientation: Orientation;
  lang?: PosterLang;
}

const TEXT = {
  en: {
    headline: "Order on WhatsApp",
    sub: "Scan with your phone camera to chat with us",
    steps: ["Scan the code", "Say what you need", "Get your price and order"],
    open: "Open any time, day or night",
    greeting: (name: string) => `Hi ${name}`,
  },
  fr: {
    headline: "Commandez sur WhatsApp",
    sub: "Scannez avec l'appareil photo de votre téléphone",
    steps: ["Scannez le code", "Dites ce qu'il vous faut", "Recevez votre prix et commandez"],
    open: "Ouvert à toute heure, jour et nuit",
    greeting: (name: string) => `Bonjour ${name}`,
  },
};

const fontDir = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));
const brandMark = fileURLToPath(new URL("../../assets/brand/yarnoga-mark-128.png", import.meta.url));
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  GlobalFonts.registerFromPath(`${fontDir}Inter-Regular.otf`, "Inter");
  GlobalFonts.registerFromPath(`${fontDir}Inter-SemiBold.otf`, "Inter SemiBold");
  GlobalFonts.registerFromPath(`${fontDir}Inter-ExtraBold.otf`, "Inter ExtraBold");
  fontsLoaded = true;
}

const SIZE = { portrait: { w: 1240, h: 1754 }, landscape: { w: 1754, h: 1240 } };
const INK = "#111827";
const MUTED = "#4b5563";

/** The link in the QR code: opens a chat with the business, greeting already typed. */
export function chatLink(whatsappNumber: string, businessName: string, lang: PosterLang = "en"): string {
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(TEXT[lang].greeting(businessName))}`;
}

export function safeColour(colour: string | null | undefined): string {
  return colour && /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#128c4a";
}

export async function renderPoster(input: PosterInput): Promise<Buffer> {
  loadFonts();
  const lang = input.lang ?? "en";
  const t = TEXT[lang];
  const colour = safeColour(input.colour);
  const { w, h } = SIZE[input.orientation];
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const logo = await readImage(input.logo);
  const mark = await readImage(null, brandMark);
  const link = chatLink(input.whatsappNumber, input.businessName, lang);
  const number = showWaId(input.whatsappNumber);

  if (input.orientation === "portrait") {
    // Coloured band with the logo and name.
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, w, 430);
    let y = 70;
    if (logo) {
      drawContained(ctx, logo, w / 2 - 110, y, 220, 160, true);
      y += 190;
    } else y += 60;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    fitText(ctx, input.businessName, w - 160, 92, "Inter ExtraBold");
    ctx.fillText(input.businessName, w / 2, y);

    ctx.fillStyle = INK;
    ctx.font = "84px Inter ExtraBold";
    fitText(ctx, t.headline, w - 140, 84, "Inter ExtraBold");
    ctx.fillText(t.headline, w / 2, 500);
    ctx.fillStyle = MUTED;
    fitText(ctx, t.sub, w - 160, 38, "Inter");
    ctx.fillText(t.sub, w / 2, 610);

    drawQr(ctx, link, w / 2 - 330, 690, 660, colour);

    ctx.fillStyle = INK;
    ctx.font = "64px Inter ExtraBold";
    ctx.fillText(number, w / 2, 1385);
    if (input.tagline) {
      ctx.fillStyle = MUTED;
      fitText(ctx, input.tagline, w - 200, 36, "Inter SemiBold");
      ctx.fillText(input.tagline, w / 2, 1470);
    }
    drawSteps(ctx, t.steps, 90, 1540, w - 180, colour);
  } else {
    // Left: name, headline, steps. Right: the QR code.
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, w, 24);
    ctx.fillRect(0, h - 24, w, 24);
    const left = 100;
    const textWidth = 860;
    let y = 110;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    if (logo) {
      drawContained(ctx, logo, left, y, 200, 150, false);
      y += 180;
    }
    ctx.fillStyle = colour;
    fitText(ctx, input.businessName, textWidth, 80, "Inter ExtraBold");
    ctx.fillText(input.businessName, left, y);
    y += 120;
    ctx.fillStyle = INK;
    fitText(ctx, t.headline, textWidth, 78, "Inter ExtraBold");
    ctx.fillText(t.headline, left, y);
    y += 105;
    ctx.fillStyle = MUTED;
    fitText(ctx, t.sub, textWidth, 34, "Inter");
    ctx.fillText(t.sub, left, y);
    y += 70;
    if (input.tagline) {
      fitText(ctx, input.tagline, textWidth, 32, "Inter SemiBold");
      ctx.fillText(input.tagline, left, y);
      y += 60;
    }
    drawSteps(ctx, t.steps, left, Math.max(y + 20, 760), textWidth, colour);

    drawQr(ctx, link, 1060, 170, 600, colour);
    ctx.textAlign = "center";
    ctx.fillStyle = INK;
    ctx.font = "56px Inter ExtraBold";
    ctx.fillText(number, 1360, 820);
    ctx.fillStyle = MUTED;
    ctx.font = "30px Inter";
    ctx.fillText(t.open, 1360, 900);
  }

  // Footer.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#9ca3af";
  ctx.font = "26px Inter";
  const footer = "Powered by yarnOga · yarnoga.com";
  const fw = ctx.measureText(footer).width;
  const fy = h - 60;
  if (mark) ctx.drawImage(mark, w / 2 - fw / 2 - 46, fy - 30, 36, 36);
  ctx.fillText(footer, w / 2, fy);

  return canvas.toBuffer("image/png");
}

/** The same poster as a one-page A4 PDF, ready to print. */
export async function renderPosterPdf(input: PosterInput): Promise<Uint8Array> {
  loadFonts();
  const png = await renderPoster(input);
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  const jpeg = canvas.toBuffer("image/jpeg", 95);
  const page = A4[input.orientation];
  return jpegsToPdf([{ jpeg, widthPx: image.width, heightPx: image.height, widthPt: page.w, heightPt: page.h }]);
}

async function readImage(data: Uint8Array | null | undefined, path?: string): Promise<Image | null> {
  try {
    if (data) return await loadImage(Buffer.from(data));
    if (path) return await loadImage(path);
  } catch {
    // An unreadable logo shouldn't stop the poster.
  }
  return null;
}

function drawContained(ctx: SKRSContext2D, img: Image, x: number, y: number, maxW: number, maxH: number, centred: boolean) {
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = centred ? x + (maxW - dw) / 2 : x;
  // A white card behind the logo, so logos with dark or clear backgrounds show up on any colour.
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, dx - 14, y - 14, dw + 28, dh + 28, 18);
  ctx.fill();
  ctx.drawImage(img, dx, y, dw, dh);
}

function drawQr(ctx: SKRSContext2D, text: string, x: number, y: number, size: number, colour: string) {
  ctx.fillStyle = colour;
  roundRect(ctx, x - 18, y - 18, size + 36, size + 36, 36);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, size, size, 24);
  ctx.fill();
  const qr = QRCode.create(text, { errorCorrectionLevel: "Q" }).modules;
  const quiet = 3;
  const cell = Math.floor(size / (qr.size + 2 * quiet));
  const offset = (size - cell * qr.size) / 2;
  ctx.fillStyle = "#000000";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.get(r, c)) ctx.fillRect(x + offset + c * cell, y + offset + r * cell, cell, cell);
    }
  }
}

function drawSteps(ctx: SKRSContext2D, steps: string[], x: number, y: number, width: number, colour: string) {
  const each = width / steps.length;
  ctx.textBaseline = "top";
  steps.forEach((step, i) => {
    const cx = x + each * i + each / 2;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(cx, y + 34, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = "38px Inter ExtraBold";
    ctx.fillText(String(i + 1), cx, y + 13);
    ctx.fillStyle = INK;
    fitText(ctx, step, each - 24, 30, "Inter SemiBold");
    ctx.fillText(step, cx, y + 88);
  });
}

/** Sets the largest font size up to `max` at which `text` fits `width`. */
function fitText(ctx: SKRSContext2D, text: string, width: number, max: number, family: string) {
  let size = max;
  ctx.font = `${size}px ${family}`;
  while (size > 14 && ctx.measureText(text).width > width) {
    size -= 2;
    ctx.font = `${size}px ${family}`;
  }
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

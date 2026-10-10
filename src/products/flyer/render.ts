// Draws the flyer images: a birthday flyer for one member, and an "event"
// flyer that brands any photo with the group's logo and a caption.
// Pure drawing code: it takes image bytes and text, and returns a JPEG.
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";

// The fonts ship with the code (assets/fonts), so flyers look the same on
// Railway as on a laptop, whatever fonts the server has installed.
const fontDir = fileURLToPath(new URL("../../../assets/fonts/", import.meta.url));
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  GlobalFonts.registerFromPath(`${fontDir}Poppins-Regular.ttf`, "Poppins");
  GlobalFonts.registerFromPath(`${fontDir}Poppins-SemiBold.ttf`, "Poppins SemiBold");
  GlobalFonts.registerFromPath(`${fontDir}Poppins-ExtraBold.ttf`, "Poppins ExtraBold");
  GlobalFonts.registerFromPath(`${fontDir}GreatVibes-Regular.ttf`, "Great Vibes");
  fontsLoaded = true;
}

const WIDTH = 1080;
const HEIGHT = 1350; // 4:5 portrait, the shape WhatsApp shows largest in a chat

const GOLD = "#f5c451";
const WHITE = "#ffffff";

export interface BirthdayFlyerInput {
  photo: Uint8Array;
  name: string;
  /** Shown under the name, e.g. "14 October". */
  dateLabel: string;
  groupName: string;
  logo?: Uint8Array;
}

export interface EventFlyerInput {
  photo: Uint8Array;
  caption: string;
  logo?: Uint8Array;
}

export async function renderBirthdayFlyer(input: BirthdayFlyerInput): Promise<Buffer> {
  loadFonts();
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background: deep purple to wine, with soft confetti.
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, "#1d1350");
  bg.addColorStop(1, "#6b1757");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawConfetti(ctx, seedFrom(input.name));

  // Group logo and name at the top.
  let y = 70;
  if (input.logo) {
    const logo = await loadImage(input.logo);
    const box = fitInside(logo, 150, 120);
    ctx.drawImage(logo, (WIDTH - box.w) / 2, y, box.w, box.h);
    y += box.h + 16;
  } else {
    y += 20;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  fitText(ctx, input.groupName.toUpperCase(), "Poppins SemiBold", 30, WIDTH - 160);
  ctx.fillText(input.groupName.toUpperCase(), WIDTH / 2, y);
  y += 56;

  // "Happy BIRTHDAY"
  ctx.fillStyle = GOLD;
  ctx.font = `110px "Great Vibes"`;
  ctx.fillText("Happy", WIDTH / 2, y);
  y += 118;
  ctx.fillStyle = WHITE;
  ctx.font = `104px "Poppins ExtraBold"`;
  ctx.fillText("BIRTHDAY", WIDTH / 2, y);
  y += 140;

  // Round photo with a gold ring.
  const photo = await loadImage(input.photo);
  const radius = 255;
  const cx = WIDTH / 2;
  const cy = y + radius + 14;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 40;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 14, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  drawCover(ctx, photo, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
  y = cy + radius + 50;

  // Name and date.
  ctx.fillStyle = WHITE;
  fitText(ctx, input.name, "Poppins SemiBold", 76, WIDTH - 140);
  ctx.fillText(input.name, WIDTH / 2, y);
  y += 104;
  ctx.fillStyle = GOLD;
  ctx.font = `40px "Poppins"`;
  ctx.fillText(input.dateLabel, WIDTH / 2, y);

  return canvas.encode("jpeg", 90);
}

export async function renderEventFlyer(input: EventFlyerInput): Promise<Buffer> {
  loadFonts();
  const photo = await loadImage(input.photo);
  // Keep the photo's shape, between a 4:5 portrait and a 1.91:1 landscape
  // (WhatsApp crops anything outside that range in the chat preview).
  const ratio = Math.min(Math.max(photo.width / photo.height, 4 / 5), 1.91);
  const width = WIDTH;
  const height = Math.round(width / ratio);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  drawCover(ctx, photo, 0, 0, width, height);

  const pad = Math.round(width * 0.05);

  // Caption on a dark fade at the bottom so it reads on any photo.
  const caption = input.caption.trim();
  if (caption) {
    ctx.font = `10px "Poppins SemiBold"`;
    // Smaller text on wide photos, so the caption never covers more than about a third.
    const maxSize = Math.min(64, Math.round(height * 0.06));
    const { lines, size } = wrapToFit(ctx, caption, "Poppins SemiBold", maxSize, 26, width - pad * 2, 4);
    const lineHeight = Math.round(size * 1.25);
    const textHeight = lines.length * lineHeight;
    const fadeTop = height - textHeight - pad * 2 - 120;
    const fade = ctx.createLinearGradient(0, fadeTop, 0, height);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(0.45, "rgba(0,0,0,0.6)");
    fade.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, fadeTop, width, height - fadeTop);

    ctx.fillStyle = WHITE;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 8;
    let y = height - pad - textHeight;
    for (const line of lines) {
      ctx.fillText(line, pad, y);
      y += lineHeight;
    }
    ctx.shadowBlur = 0;
    // A short gold rule above the caption.
    ctx.fillStyle = GOLD;
    ctx.fillRect(pad, height - pad - textHeight - 28, 120, 8);
  }

  // Logo in the top-right corner.
  if (input.logo) {
    const logo = await loadImage(input.logo);
    const max = Math.round(Math.min(width, height) * 0.18);
    const box = fitInside(logo, max, max);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 18;
    ctx.drawImage(logo, width - pad - box.w, pad, box.w, box.h);
    ctx.restore();
  }

  return canvas.encode("jpeg", 90);
}

/** Draws an image to fill the box, cropping the overflow (like CSS object-fit: cover). */
function drawCover(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  // For tall photos, keep more of the top: that's usually where the face is.
  const sy = (img.height - sh) * 0.25;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function fitInside(img: Image, maxW: number, maxH: number) {
  const scale = Math.min(maxW / img.width, maxH / img.height);
  return { w: Math.round(img.width * scale), h: Math.round(img.height * scale) };
}

/** Sets the font, shrinking it until `text` fits on one line. */
function fitText(ctx: SKRSContext2D, text: string, family: string, size: number, maxWidth: number) {
  let s = size;
  ctx.font = `${s}px "${family}"`;
  while (s > 18 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${s}px "${family}"`;
  }
}

/** Splits text into lines, shrinking the font until it fits in `maxLines`. */
export function wrapToFit(
  ctx: SKRSContext2D,
  text: string,
  family: string,
  maxSize: number,
  minSize: number,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; size: number } {
  let lines: string[] = [];
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `${size}px "${family}"`;
    lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { lines, size };
  }
  return { lines: lines.slice(0, maxLines), size: minSize };
}

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawConfetti(ctx: SKRSContext2D, seed: number) {
  const rand = mulberry32(seed);
  const colours = [GOLD, "#ff7eb6", "#7ee0ff", "#ffffff"];
  for (let i = 0; i < 70; i++) {
    ctx.save();
    ctx.globalAlpha = 0.25 + rand() * 0.35;
    ctx.fillStyle = colours[Math.floor(rand() * colours.length)]!;
    ctx.translate(rand() * WIDTH, rand() * HEIGHT);
    ctx.rotate(rand() * Math.PI);
    if (rand() < 0.5) {
      ctx.fillRect(-9, -4, 18, 8);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 4 + rand() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Same name, same confetti: a re-sent flyer looks identical.
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

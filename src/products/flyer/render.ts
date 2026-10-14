// Draws the flyer images: a birthday flyer for one member, and an "event"
// flyer that brands any photo with the group's logo and a caption.
// Pure drawing code: it takes image bytes and text, and returns a JPEG.
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { renderGoldStars, SAMPLE_WISH } from "./goldstars.js";
import { personLayer, renderCalendar, renderGala, renderSunflower, renderWhiteGold } from "./designs4.js";
import { DESIGNS_7 } from "./designs7.js";
import { themeById, type Theme } from "./themes.js";

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
  GlobalFonts.registerFromPath(`${fontDir}PlayfairDisplay-Bold.ttf`, "Playfair Display Bold");
  GlobalFonts.registerFromPath(`${fontDir}PlayfairDisplay-Black.ttf`, "Playfair Display Black");
  GlobalFonts.registerFromPath(`${fontDir}Pacifico-Regular.ttf`, "Pacifico");
  fontsLoaded = true;
}

const WIDTH = 1080;
const HEIGHT = 1350; // 4:5 portrait, the shape WhatsApp shows largest in a chat

const WHITE = "#ffffff";

/** How a group's flyers look: its chosen design plus any changes it made. */
export interface FlyerStyle {
  theme: Theme;
  /** Replaces the design's accent colour. */
  accent?: string;
  /** A background picture the group uploaded, used instead of the design's colours. */
  background?: Uint8Array;
  /** Small print at the bottom, e.g. "Made with FlyerBot · wa.me/234...". */
  credit?: string;
}

const DEFAULT_STYLE: FlyerStyle = { theme: themeById(undefined) };

export interface BirthdayFlyerInput {
  /** Their photo. Without one, the flyer shows their initials instead. */
  photo?: Uint8Array;
  /** The person cut out of their photo (see cutout.ts), for designs that stand them in front. */
  cutout?: Uint8Array;
  name: string;
  /** Shown under the name, e.g. "14 October". */
  dateLabel: string;
  groupName: string;
  logo?: Uint8Array;
  style?: FlyerStyle;
  /** The birthday message, printed by the gold stars, gala and white and gold designs; previews use a sample. */
  wish?: string;
}

export interface EventFlyerInput {
  photo: Uint8Array;
  caption: string;
  logo?: Uint8Array;
  style?: FlyerStyle;
}

/** The ready-made designs from designs4.ts and designs7.ts, by layout. They draw everything themselves. */
const READY_MADE = {
  gala: renderGala,
  sunflower: renderSunflower,
  whitegold: renderWhiteGold,
  calendar: renderCalendar,
  ...DESIGNS_7,
};

export async function renderBirthdayFlyer(input: BirthdayFlyerInput): Promise<Buffer> {
  loadFonts();
  const style = input.style ?? DEFAULT_STYLE;
  const theme = style.theme;
  const accent = style.accent ?? theme.accent;
  if (theme.layout === "stars") {
    return renderGoldStars({
      photo: input.photo ?? (await initialsPortrait(input.name, theme.background, accent)),
      name: input.name,
      dateLabel: input.dateLabel,
      groupName: input.groupName,
      wish: input.wish,
      logo: input.logo,
      credit: style.credit,
    });
  }
  const ready = READY_MADE[theme.layout as keyof typeof READY_MADE];
  if (ready) {
    return ready({
      photo: input.photo ?? (await initialsPortrait(input.name, theme.background, accent)),
      cutout: theme.cutout ? input.cutout : undefined,
      logo: input.logo,
      name: input.name,
      dateLabel: input.dateLabel,
      groupName: input.groupName,
      wish: input.wish || SAMPLE_WISH,
      credit: style.credit,
    });
  }
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background: the group's own picture, or the design's colours.
  if (style.background) {
    drawCover(ctx, await loadImage(style.background), 0, 0, WIDTH, HEIGHT);
  } else {
    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, theme.background[0]);
    bg.addColorStop(1, theme.background[1]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (theme.confetti) drawConfetti(ctx, seedFrom(input.name), accent);
  }

  const photo = await loadImage(input.photo ?? (await initialsPortrait(input.name, theme.background, accent)));
  const logo = input.logo ? await loadImage(input.logo) : undefined;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  if (theme.layout === "full") {
    // Photo across the top, fading into the background colour below. With a
    // cut-out, the person stands on the background instead, lit from behind.
    const photoHeight = 860;
    if (input.cutout && theme.cutout) {
      const glow = ctx.createRadialGradient(WIDTH / 2, 420, 40, WIDTH / 2, 420, 560);
      glow.addColorStop(0, withAlpha(accent, 0.45));
      glow.addColorStop(1, withAlpha(accent, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, WIDTH, photoHeight);
      const layer = personLayer(await loadImage(input.cutout), 900, photoHeight - 40, 0.8);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 40;
      ctx.drawImage(layer, (WIDTH - 900) / 2, 40);
      ctx.restore();
    } else {
      drawCover(ctx, photo, 0, 0, WIDTH, photoHeight);
    }
    if (!style.background && !(input.cutout && theme.cutout)) {
      const fade = ctx.createLinearGradient(0, photoHeight - 300, 0, photoHeight);
      fade.addColorStop(0, withAlpha(theme.background[0], 0));
      fade.addColorStop(1, theme.background[0]);
      ctx.fillStyle = fade;
      ctx.fillRect(0, photoHeight - 300, WIDTH, 300);
    }
    if (logo) {
      const box = fitInside(logo, 150, 150);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 18;
      ctx.drawImage(logo, WIDTH - 54 - box.w, 54, box.w, box.h);
      ctx.restore();
    }
    let y = photoHeight - 70;
    ctx.fillStyle = accent;
    ctx.font = `100px "Great Vibes"`;
    ctx.fillText("Happy", WIDTH / 2, y);
    y += 100;
    ctx.fillStyle = theme.text;
    ctx.font = `92px "Poppins ExtraBold"`;
    ctx.fillText("BIRTHDAY", WIDTH / 2, y);
    y += 120;
    fitText(ctx, input.name, "Poppins SemiBold", 66, WIDTH - 140);
    ctx.fillText(input.name, WIDTH / 2, y);
    y += 86;
    ctx.fillStyle = accent;
    ctx.font = `36px "Poppins"`;
    ctx.fillText(`${input.dateLabel}  •  ${input.groupName}`, WIDTH / 2, y);
  } else {
    // Group logo and name at the top.
    let y = 70;
    if (logo) {
      const box = fitInside(logo, 150, 120);
      ctx.drawImage(logo, (WIDTH - box.w) / 2, y, box.w, box.h);
      y += box.h + 16;
    } else {
      y += 20;
    }
    ctx.fillStyle = theme.muted;
    fitText(ctx, input.groupName.toUpperCase(), "Poppins SemiBold", 30, WIDTH - 160);
    ctx.fillText(input.groupName.toUpperCase(), WIDTH / 2, y);
    y += 56;

    // "Happy BIRTHDAY"
    ctx.fillStyle = accent;
    ctx.font = `110px "Great Vibes"`;
    ctx.fillText("Happy", WIDTH / 2, y);
    y += 118;
    ctx.fillStyle = theme.text;
    ctx.font = `104px "Poppins ExtraBold"`;
    ctx.fillText("BIRTHDAY", WIDTH / 2, y);
    y += 140;

    // Round photo with a coloured ring.
    const radius = 255;
    const cx = WIDTH / 2;
    const cy = y + radius + 14;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 40;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 14, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, photo, cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
    y = cy + radius + 44;

    // Name and date.
    ctx.fillStyle = theme.text;
    fitText(ctx, input.name, "Poppins SemiBold", 76, WIDTH - 140);
    ctx.fillText(input.name, WIDTH / 2, y);
    y += 100;
    ctx.fillStyle = accent;
    ctx.font = `40px "Poppins"`;
    ctx.fillText(input.dateLabel, WIDTH / 2, y);
  }

  if (style.credit) {
    ctx.fillStyle = theme.muted;
    fitText(ctx, style.credit, "Poppins", 22, WIDTH - 80);
    ctx.textBaseline = "bottom";
    ctx.fillText(style.credit, WIDTH / 2, HEIGHT - 18);
  }

  return canvas.encode("jpeg", 90);
}

export async function renderEventFlyer(input: EventFlyerInput): Promise<Buffer> {
  loadFonts();
  const style = input.style ?? DEFAULT_STYLE;
  const accent = style.accent ?? style.theme.accent;
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
  // Leave room for the small print under the caption.
  const bottom = height - pad - (style.credit ? 24 : 0);

  // Caption on a dark fade at the bottom so it reads on any photo.
  const caption = input.caption.trim();
  if (caption || style.credit) {
    let textHeight = 0;
    let lines: string[] = [];
    let lineHeight = 0;
    if (caption) {
      // Smaller text on wide photos, so the caption never covers more than about a third.
      const maxSize = Math.min(64, Math.round(height * 0.06));
      const fit = wrapToFit(ctx, caption, "Poppins SemiBold", maxSize, 26, width - pad * 2, 4);
      lines = fit.lines;
      lineHeight = Math.round(fit.size * 1.25);
      textHeight = lines.length * lineHeight;
      ctx.font = `${fit.size}px "Poppins SemiBold"`;
    }
    const fadeTop = caption ? bottom - textHeight - pad - 120 : height - 120;
    const fade = ctx.createLinearGradient(0, fadeTop, 0, height);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(0.45, "rgba(0,0,0,0.6)");
    fade.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, fadeTop, width, height - fadeTop);

    if (caption) {
      ctx.fillStyle = WHITE;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 8;
      let y = bottom - textHeight;
      for (const line of lines) {
        ctx.fillText(line, pad, y);
        y += lineHeight;
      }
      ctx.shadowBlur = 0;
      // A short line in the accent colour above the caption.
      ctx.fillStyle = accent;
      ctx.fillRect(pad, bottom - textHeight - 28, 120, 8);
    }

    if (style.credit) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      fitText(ctx, style.credit, "Poppins", 20, width - pad * 2);
      ctx.fillText(style.credit, width - pad, height - 16);
    }
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

/** One design on a design sheet: its number (what admins type) and an optional note under its name. */
export interface DesignSheetItem {
  theme: Theme;
  number: number;
  /** e.g. "Standard plan" for one the group's plan doesn't include. */
  note?: string;
}

/**
 * One picture showing a page of designs, numbered, so an admin can pick one by
 * replying "design 8". Uses one of the group's members as the example.
 */
export async function renderDesignSheet(
  sample: Omit<BirthdayFlyerInput, "style">,
  items: DesignSheetItem[],
  extras: Omit<FlyerStyle, "theme"> = {},
): Promise<Buffer> {
  loadFonts();
  const cols = 3;
  const rows = Math.ceil(items.length / cols);
  const thumbW = 340;
  const thumbH = Math.round(thumbW * (HEIGHT / WIDTH));
  const gap = 30;
  const labelH = 96;
  const width = cols * thumbW + (cols + 1) * gap;
  const height = rows * (thumbH + labelH) + (rows + 1) * gap;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f2f2f2";
  ctx.fillRect(0, 0, width, height);

  for (const [i, item] of items.entries()) {
    const flyer = await loadImage(await renderBirthdayFlyer({ ...sample, style: { ...extras, theme: item.theme } }));
    const x = gap + (i % cols) * (thumbW + gap);
    const y = gap + Math.floor(i / cols) * (thumbH + labelH + gap);
    ctx.drawImage(flyer, x, y, thumbW, thumbH);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const label = `${item.number}. ${item.theme.label}`;
    ctx.fillStyle = "#222222";
    fitText(ctx, label, "Poppins SemiBold", 26, thumbW);
    ctx.fillText(label, x, y + thumbH + 12);
    if (item.note) {
      ctx.fillStyle = "#8a6d1f";
      fitText(ctx, item.note, "Poppins", 22, thumbW);
      ctx.fillText(item.note, x, y + thumbH + 50);
    }
  }
  return canvas.encode("jpeg", 85);
}

/** A stand-in photo for someone without one: their initials on the design's colours. */
async function initialsPortrait(name: string, background: [string, string], accent: string): Promise<Buffer> {
  loadFonts();
  const canvas = createCanvas(800, 1000);
  const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, 800, 1000);
  bg.addColorStop(0, background[1]);
  bg.addColorStop(1, background[0]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 800, 1000);
  // Soften it so it reads as a photo area on any design.
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, 800, 1000);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  ctx.fillStyle = accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `300px "Poppins SemiBold"`;
  ctx.fillText(initials || "?", 400, 380);
  return canvas.encode("jpeg", 90);
}

/** The same outline on a see-through background: the example cut-out before a group has members. */
export async function placeholderCutout(): Promise<Buffer> {
  const canvas = createCanvas(800, 1000);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#5b6b7c";
  ctx.beginPath();
  ctx.ellipse(400, 360, 150, 180, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(400, 980, 330, 360, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas.encode("png");
}

/** A plain head-and-shoulders outline, used as the example photo before a group has members. */
export async function placeholderPortrait(): Promise<Buffer> {
  const canvas = createCanvas(800, 1000);
  const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, 0, 1000);
  bg.addColorStop(0, "#c9d6e3");
  bg.addColorStop(1, "#8aa1b8");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 800, 1000);
  ctx.fillStyle = "#5b6b7c";
  ctx.beginPath();
  ctx.ellipse(400, 360, 150, 180, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(400, 980, 330, 360, 0, 0, Math.PI * 2);
  ctx.fill();
  return canvas.encode("jpeg", 90);
}

/** "#0d1b3d" with 0 alpha -> "rgba(13,27,61,0)". */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})`;
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

function drawConfetti(ctx: SKRSContext2D, seed: number, accent: string) {
  const rand = mulberry32(seed);
  const colours = [accent, "#ff7eb6", "#7ee0ff", "#ffffff"];
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

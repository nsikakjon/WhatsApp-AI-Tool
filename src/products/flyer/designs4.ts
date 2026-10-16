// Four birthday designs drawn with @napi-rs/canvas, the library the Flyer Bot uses, and only
// the bot's own fonts (Poppins, Great Vibes). Every design takes the same input:
//   { photo, name, dateLabel: "22 October", groupName, wish, credit }
import { drawCredit } from "./credit.js";
import {
  createCanvas,
  loadImage,
  type Image,
  type SKRSContext2D,
  type CanvasGradient,
  type Canvas,
} from "@napi-rs/canvas";

type Ctx = SKRSContext2D;
type Fade = (ctx: Ctx, w: number, h: number) => CanvasGradient;

/** What every design here takes. dateLabel is like "22 October". */
export interface DesignInput {
  photo?: Uint8Array;
  /** The person cut out of the photo (a see-through PNG), when there is one. */
  cutout?: Uint8Array;
  name: string;
  dateLabel: string;
  groupName: string;
  wish?: string;
  credit?: string;
  year?: number;
}
export const W = 1080,
  H = 1350;
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// ---------- shared helpers ----------

export function rng(seed: string): () => number {
  let s = 7;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** "22 October" -> { day: 22, month: 9 } (month is 0-11). */
export function parseDate(label: string): { day: number; month: number } | null {
  const m = label.trim().match(/^(\d{1,2})\s+([A-Za-z]+)/);
  if (!m) return null;
  const month = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3)));
  return month < 0 ? null : { day: Number(m[1]), month };
}

export function ordinal(n: number): string {
  const s = ["TH", "ST", "ND", "RD"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Draws the image to cover the box; fx/fy pick which part stays in view (0.5 = centre). */
export function cover(ctx: Ctx, img: Image | Canvas, x: number, y: number, w: number, h: number, fx = 0.5, fy = 0.3) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s,
    ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) * fx, y + (h - ih) * fy, iw, ih);
}

/**
 * The cut-out person on their own w x h layer: as big as fits, centred, feet
 * (or shoulders) on the bottom edge, which fades out from `fadeFrom` (0-1 of
 * the height) so the cut edge melts into the design.
 */
export function personLayer(img: Image, w: number, h: number, fadeFrom = 0.85): Canvas {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  const s = Math.min(w / img.width, h / img.height);
  const iw = img.width * s,
    ih = img.height * s;
  ctx.drawImage(img, (w - iw) / 2, h - ih, iw, ih);
  if (fadeFrom < 1) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = fadeBottom(fadeFrom, 1)(ctx, w, h);
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

/** Draws a layer with a soft shadow behind it, so a cut-out person stands off the background. */
export function withShadow(ctx: Ctx, layer: Canvas, x: number, y: number, colour = "rgba(0,0,0,0.35)", blur = 30) {
  ctx.save();
  ctx.shadowColor = colour;
  ctx.shadowBlur = blur;
  ctx.drawImage(layer, x, y);
  ctx.restore();
}

/** The photo on its own layer, faded out by each gradient in `fades` (applied one after another). */
export function fadedPhoto(img: Image, w: number, h: number, fades: Fade[], fx?: number, fy?: number): Canvas {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  cover(ctx, img, 0, 0, w, h, fx, fy);
  ctx.globalCompositeOperation = "destination-in";
  for (const make of fades) {
    ctx.fillStyle = make(ctx, w, h);
    ctx.fillRect(0, 0, w, Math.max(w, h));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  return c;
}
export const fadeTop =
  (from: number, to: number): Fade =>
  (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h * from, 0, h * to);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "#000");
    return g;
  };
export const fadeBottom =
  (from: number, to: number): Fade =>
  (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h * from, 0, h * to);
    g.addColorStop(0, "#000");
    g.addColorStop(1, "rgba(0,0,0,0)");
    return g;
  };
export const fadeSides =
  (edge: number): Fade =>
  (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(edge, "#000");
    g.addColorStop(1 - edge, "#000");
    g.addColorStop(1, "rgba(0,0,0,0)");
    return g;
  };

/** Keeps an oval in the middle of the layer and fades everything outside it. */
export const fadeOval =
  (inner = 0.55): Fade =>
  (ctx, w, h) => {
    ctx.setTransform(1, 0, 0, h / w, 0, 0);
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "#000");
    g.addColorStop(inner, "#000");
    g.addColorStop(1, "rgba(0,0,0,0)");
    return g;
  };

/** Text with extra space between letters, drawn centred, left or right. */
export function spaced(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: "left" | "center" | "right" = "left",
  mode: "fill" | "stroke" = "fill",
) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  [...text].forEach((ch, i) => {
    mode === "stroke" ? ctx.strokeText(ch, cx, y) : ctx.fillText(ch, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.textAlign = prev;
  return total;
}

/** Letters placed around a circle, reading clockwise from the top. */
export function circleText(ctx: Ctx, text: string, cx: number, cy: number, r: number, startAngle = -Math.PI / 2) {
  const total = [...text].reduce((a, ch) => a + ctx.measureText(ch).width, 0);
  let a = startAngle - total / r / 2;
  ctx.save();
  ctx.textAlign = "center";
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    a += w / 2 / r;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += w / 2 / r;
  }
  ctx.restore();
}

/** Repeats `word ·` until it fills the whole ring. */
export function ringText(ctx: Ctx, word: string, cx: number, cy: number, r: number) {
  const unit = `${word} • `;
  const n = Math.max(1, Math.floor((2 * Math.PI * r) / ctx.measureText(unit).width));
  const spare = 2 * Math.PI * r - n * ctx.measureText(unit).width;
  const gap = spare / [...unit.repeat(n)].length;
  let a = -Math.PI / 2;
  ctx.save();
  ctx.textAlign = "center";
  for (const ch of unit.repeat(n)) {
    const w = ctx.measureText(ch).width + gap;
    a += w / 2 / r;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += w / 2 / r;
  }
  ctx.restore();
}

export function metal(ctx: Ctx, y0: number, y1: number, stops: string[]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}
export const GOLD = ["#fff6c8", "#f3cf6b", "#c8901f", "#8a5a12", "#e9bd55", "#fff1b0"];
const SILVER = ["#ffffff", "#f4f6f8", "#c9cfd6", "#8e96a1", "#e6eaee", "#ffffff"];

export function fitFont(ctx: Ctx, text: string, weightFamily: string, max: number, min: number, maxWidth: number): number {
  let size = max;
  ctx.font = `${size}px ${weightFamily}`;
  while (ctx.measureText(text).width > maxWidth && size > min) {
    size -= 2;
    ctx.font = `${size}px ${weightFamily}`;
  }
  return size;
}

export function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Wraps the birthday message into at most maxLines (a number, or one per font
 * size when smaller text can take more lines), shrinking the font from
 * max down to min so the whole message fits. If it is still too long at min,
 * the last line ends in "...". Emoji are dropped (the fonts have none).
 */
export function fitWish(
  ctx: Ctx,
  text: string | undefined,
  family: string,
  max: number,
  min: number,
  maxWidth: number,
  maxLines: number | ((size: number) => number),
): { lines: string[]; size: number } {
  const clean = (text ?? "")
    .replace(/\*\*/g, "")
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return { lines: [], size: max };
  const linesAt = typeof maxLines === "number" ? () => maxLines : maxLines;
  let lines: string[] = [];
  for (let size = max; size >= min; size -= 1) {
    ctx.font = `${size}px ${family}`;
    lines = wrap(ctx, clean, maxWidth);
    if (lines.length <= linesAt(size)) return { lines, size };
  }
  const most = linesAt(min);
  lines = lines.slice(0, most);
  let last = lines[most - 1]!;
  while (last.includes(" ") && ctx.measureText(`${last}...`).width > maxWidth)
    last = last.slice(0, last.lastIndexOf(" "));
  lines[most - 1] = `${last}...`;
  return { lines, size: min };
}

export function bokeh(
  ctx: Ctx,
  rand: () => number,
  n: number,
  area: { x: number; y: number; w: number; h: number },
  colours: string[],
  rMin: number,
  rMax: number,
) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = area.x + rand() * area.w,
      y = area.y + rand() * area.h,
      r = rMin + rand() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colours[Math.floor(rand() * colours.length)];
    g.addColorStop(0, c);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.25 + rand() * 0.5;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A glossy party balloon or Christmas-style ornament ball; `blur` softens it as if out of focus. */
export function balloon(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  base: string,
  dark: string,
  { blur = 0, string = true, oval = 1.18 } = {},
) {
  ctx.save();
  if (blur) ctx.filter = `blur(${blur}px)`;
  if (string) {
    ctx.strokeStyle = "rgba(90,90,90,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + r * oval);
    ctx.bezierCurveTo(x - r * 0.3, y + r * 1.8, x + r * 0.3, y + r * 2.2, x - r * 0.1, y + r * 3);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r * 1.2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.12, base);
  g.addColorStop(0.75, base);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * oval, 0, 0, Math.PI * 2);
  ctx.fill();
  if (string) {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.12, y + r * oval + 8);
    ctx.lineTo(x + r * 0.12, y + r * oval + 8);
    ctx.lineTo(x, y + r * oval - 4);
    ctx.fill();
  }
  ctx.restore();
}

export function sparkle(ctx: Ctx, x: number, y: number, r: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

export function creditLine(
  ctx: Ctx,
  credit: string | undefined,
  _colour: string,
  align: CanvasTextAlign = "center",
  x = W / 2,
  _halo?: string,
) {
  // Every design now shows the same yarnOga tag; the colour arguments are kept so the designs read the same.
  drawCredit(ctx, credit, W, H, align, x);
}

// ---------- 1. Gala: dark cinematic photo, gold lettering, date seal ----------

export async function renderGala({ photo, cutout, name, dateLabel, groupName, wish, credit }: DesignInput): Promise<Buffer> {
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "gala");
  ctx.fillStyle = "#1a0b07";
  ctx.fillRect(0, 0, W, H);
  // With a cut-out, the room is drawn empty and the person stands in it (below).
  if (cutout) {
    const room = ctx.createLinearGradient(0, 0, 0, 1120);
    room.addColorStop(0, "#6b3420");
    room.addColorStop(1, "#2a120a");
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, W, 1120);
  } else if (photo) cover(ctx, await loadImage(photo), 0, 0, W, 1120, 0.5, 0.2);

  // Warm, dark grade so any photo reads as an evening party.
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#b0603a";
  ctx.fillRect(0, 0, W, 1120);
  ctx.restore();
  const vig = ctx.createRadialGradient(W / 2, 520, 200, W / 2, 520, 900);
  vig.addColorStop(0, "rgba(20,8,5,0)");
  vig.addColorStop(1, "rgba(20,8,5,0.75)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  // Warm window glow top-left, red velvet on the right, dark floor at the bottom.
  const glow = ctx.createRadialGradient(170, 260, 0, 170, 260, 620);
  glow.addColorStop(0, "rgba(255,190,90,0.55)");
  glow.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 7; i++) {
    const x = 850 + i * 36;
    const g = ctx.createLinearGradient(x, 0, x + 36, 0);
    g.addColorStop(0, "rgba(70,4,8,0.9)");
    g.addColorStop(0.5, "rgba(160,22,30,0.85)");
    g.addColorStop(1, "rgba(50,2,6,0.92)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 36, 1150);
  }
  const curtainFade = ctx.createLinearGradient(780, 0, 900, 0);
  curtainFade.addColorStop(0, "rgba(26,11,7,0)");
  curtainFade.addColorStop(1, "rgba(26,11,7,0.15)");
  ctx.fillStyle = curtainFade;
  ctx.fillRect(780, 0, 300, 1150);
  const floor = ctx.createLinearGradient(0, 680, 0, H);
  floor.addColorStop(0, "rgba(20,8,5,0)");
  floor.addColorStop(0.45, "rgba(20,8,5,0.85)");
  floor.addColorStop(1, "#140805");
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, W, H);
  bokeh(ctx, rand, 26, { x: 0, y: 0, w: W, h: H }, ["rgba(255,200,110,1)", "rgba(255,150,80,1)"], 8, 34);
  if (cutout) {
    // Warm rim light from the window side, then the person in front of the curtains.
    const layer = personLayer(await loadImage(cutout), 820, 900, 0.8);
    withShadow(ctx, layer, 60, 1140 - 900, "rgba(255,170,80,0.35)", 40);
  }

  // Gold ribbon curls.
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 16;
  ctx.strokeStyle = metal(ctx, 0, 420, GOLD);
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(-20, 360);
  ctx.bezierCurveTo(120, 160, 300, 420, 230, 120);
  ctx.bezierCurveTo(190, 0, 330, -30, 380, 40);
  ctx.stroke();
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(60, 520);
  ctx.bezierCurveTo(-40, 420, 140, 380, 90, 300);
  ctx.stroke();
  ctx.restore();

  // Date seal.
  const d = parseDate(dateLabel),
    sx = 890,
    sy = 640,
    sr = 100;
  ctx.save();
  ctx.fillStyle = "rgba(196,160,120,0.88)";
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, sy, sr + 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "16px Poppins SemiBold";
  ringText(ctx, "HAPPY BIRTHDAY", sx, sy, sr + 17);
  ctx.textAlign = "center";
  ctx.font = "44px Poppins SemiBold";
  ctx.fillText(d ? ordinal(d.day) : dateLabel, sx, sy - 2);
  ctx.font = "34px Poppins SemiBold";
  ctx.fillText(d ? MONTHS[d.month].toUpperCase() : "", sx, sy + 40);
  ctx.restore();

  // Gold "HAPPY BIRTHDAY".
  ctx.save();
  ctx.font = "150px Poppins ExtraBold";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = metal(ctx, 880, 1010, GOLD);
  spaced(ctx, "HAPPY", 70, 1010, 10);
  ctx.fillStyle = metal(ctx, 1030, 1160, GOLD);
  spaced(ctx, "BIRTHDAY", 70, 1160, 6);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,240,190,0.8)";
  spaced(ctx, "HAPPY", 70, 1010, 10, "left", "stroke");
  spaced(ctx, "BIRTHDAY", 70, 1160, 6, "left", "stroke");
  ctx.restore();

  ctx.fillStyle = "#ffffff";
  fitFont(ctx, name.toUpperCase(), "Poppins SemiBold", 38, 24, 860);
  spaced(ctx, name.toUpperCase(), W / 2, 1222, 7, "center");

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  fitWish(ctx, wish, "Poppins", 19, 13, 470, 3).lines.forEach((l, i) => ctx.fillText(l, 70, 1272 + i * 26));
  ctx.textAlign = "right";
  ctx.fillStyle = "#f3cf6b";
  ctx.font = "22px Poppins SemiBold";
  spaced(ctx, groupName.toUpperCase(), W - 70, 1290, 3, "right");
  ctx.textAlign = "left";
  creditLine(ctx, credit, "rgba(255,255,255,0.45)", "right", W - 70);
  return c.encode("jpeg", 90);
}

// ---------- 2. Sunflower: warm orange, silver "Birthday", name tag ----------

function sunflower(ctx: Ctx, x: number, y: number, r: number, blur: number, rot: number) {
  ctx.save();
  if (blur) ctx.filter = `blur(${blur}px)`;
  ctx.translate(x, y);
  ctx.rotate(rot);
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < 18; i++) {
      ctx.save();
      ctx.rotate((i / 18) * Math.PI * 2 + layer * 0.17);
      const g = ctx.createLinearGradient(0, -r * 0.3, 0, -r);
      g.addColorStop(0, layer ? "#ff9f0a" : "#f77f00");
      g.addColorStop(1, layer ? "#ffd43b" : "#ffb703");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.62, r * 0.13, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.32);
  cg.addColorStop(0, "#5c2a00");
  cg.addColorStop(1, "#a85a00");
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export async function renderSunflower({ photo, cutout, name, dateLabel, groupName, credit }: DesignInput): Promise<Buffer> {
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "sun");
  const bg = ctx.createRadialGradient(W / 2, 520, 50, W / 2, 620, 900);
  bg.addColorStop(0, "#ffd166");
  bg.addColorStop(0.5, "#f8961e");
  bg.addColorStop(1, "#c4410c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Huge faint "Happy" script and soft flowers behind everything.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#fff";
  ctx.font = "460px Great Vibes";
  ctx.fillText("Happy", -40, 520);
  ctx.restore();
  sunflower(ctx, 110, 150, 230, 6, 0.2);
  sunflower(ctx, 980, 330, 170, 10, 0.5);
  sunflower(ctx, 150, 1250, 260, 12, 0.1);
  sunflower(ctx, 960, 1240, 220, 8, 0.7);

  // Photo, faded at the edges so it melts into the background.
  if (cutout) {
    withShadow(ctx, personLayer(await loadImage(cutout), 760, 900, 0.78), (W - 760) / 2 + 40, 150, "rgba(120,40,0,0.35)");
  } else if (photo) {
    const img = await loadImage(photo);
    const layer = fadedPhoto(img, 760, 900, [fadeOval(0.6), fadeBottom(0.7, 1)], 0.6, 0.25);
    ctx.drawImage(layer, (W - 760) / 2, 150);
  }
  // Falling petals.
  for (let i = 0; i < 9; i++) {
    const x = rand() * W,
      y = rand() * H;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    ctx.fillStyle = rand() > 0.5 ? "#ffe066" : "#fff3bf";
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Name tag: first name on a yellow strip, the rest underneath.
  const [first, ...rest] = name.trim().split(/\s+/);
  ctx.font = "40px Poppins ExtraBold";
  const fw = ctx.measureText(first.toUpperCase()).width;
  ctx.fillStyle = "#ffe500";
  ctx.fillRect(110, 830, fw + 28, 56);
  ctx.fillStyle = "#1d1d1d";
  ctx.fillText(first.toUpperCase(), 124, 873);
  if (rest.length) {
    ctx.fillStyle = "#ffffff";
    ctx.fillText(rest.join(" ").toUpperCase(), 124, 925);
  }

  // Date ring.
  const d = parseDate(dateLabel),
    dx = 860,
    dy = 860;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(dx, dy, 72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "15px Poppins SemiBold";
  ringText(ctx, d ? MONTHS[d.month].toUpperCase() : "BIRTHDAY", dx, dy, 90);
  ctx.textAlign = "center";
  ctx.font = "70px Poppins ExtraBold";
  ctx.fillText(d ? String(d.day).padStart(2, "0") : "", dx, dy + 25);
  ctx.textAlign = "left";

  // "Happy" script over silver "Birthday".
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "96px Great Vibes";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(120,40,0,0.5)";
  ctx.shadowBlur = 12;
  ctx.fillText("Happy", W / 2 + 60, 1050);
  ctx.font = "220px Poppins SemiBold";
  ctx.fillStyle = metal(ctx, 1050, 1250, SILVER);
  ctx.shadowColor = "rgba(90,30,0,0.55)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillText("Birthday", W / 2, 1230);
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "24px Poppins SemiBold";
  ctx.textAlign = "center";
  ctx.fillText(groupName, W / 2, 1290);
  ctx.textAlign = "left";
  creditLine(ctx, credit, "rgba(255,255,255,0.75)");
  return c.encode("jpeg", 90);
}

// ---------- 3. White and gold: script title, red ornaments, date seal ----------

export async function renderWhiteGold({
  photo,
  cutout,
  name,
  dateLabel,
  groupName,
  wish,
  credit,
}: DesignInput): Promise<Buffer> {
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "white");
  const BRONZE = ["#d9a86a", "#a86f2c", "#7a4b17", "#b9823f"];
  const bg = ctx.createRadialGradient(W / 2, 500, 50, W / 2, 600, 900);
  bg.addColorStop(0, "#ffffff");
  bg.addColorStop(1, "#ecebe8");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  balloon(ctx, 980, 150, 52, "#d1001f", "#5a0010", { string: false, oval: 1, blur: 3 });
  balloon(ctx, 930, 260, 30, "#d1001f", "#5a0010", { string: false, oval: 1, blur: 6 });
  balloon(ctx, 90, 1060, 60, "#d1001f", "#5a0010", { string: false, oval: 1 });
  balloon(ctx, 180, 1170, 30, "#d1001f", "#5a0010", { string: false, oval: 1, blur: 4 });

  // Title lettering with sparkles.
  ctx.textAlign = "center";
  ctx.fillStyle = metal(ctx, 90, 160, BRONZE);
  ctx.font = "78px Poppins ExtraBold";
  spaced(ctx, "HAPPY", W / 2, 165, 12, "center");
  ctx.font = "230px Great Vibes";
  ctx.fillStyle = metal(ctx, 190, 380, BRONZE);
  ctx.fillText("Birthday", W / 2, 380);
  ctx.strokeStyle = "#a86f2c";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(330, 420);
  ctx.quadraticCurveTo(W / 2, 450, 760, 412);
  ctx.stroke();
  [
    [250, 110, 18],
    [830, 100, 22],
    [190, 260, 14],
    [900, 300, 14],
    [300, 60, 10],
    [760, 50, 12],
    [430, 470, 10],
    [660, 470, 12],
  ].forEach(([x, y, r]) => sparkle(ctx, x, y, r, "#a86f2c"));
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = "#c39255";
    ctx.beginPath();
    ctx.arc(180 + rand() * 720, 40 + rand() * 440, 3 + rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = "left";

  // Photo fading into the white page.
  if (cutout) {
    withShadow(ctx, personLayer(await loadImage(cutout), 620, 800, 0.8), (W - 620) / 2, 520, "rgba(120,80,30,0.25)");
  } else if (photo) {
    const img = await loadImage(photo);
    const layer = fadedPhoto(img, 620, 800, [fadeOval(0.55), fadeBottom(0.75, 1)], 0.5, 0.2);
    ctx.drawImage(layer, (W - 620) / 2, 520);
  }

  // Date seal (the inspo's "+1").
  const d = parseDate(dateLabel),
    bx = 800,
    by = 790;
  ctx.strokeStyle = "#a86f2c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx, by, 84, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = metal(ctx, by - 72, by + 72, BRONZE);
  ctx.beginPath();
  ctx.arc(bx, by, 72, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.font = "64px Poppins ExtraBold";
  ctx.fillText(d ? String(d.day) : "", bx, by + 14);
  ctx.font = "20px Poppins SemiBold";
  ctx.fillText(d ? MONTHS[d.month].slice(0, 3).toUpperCase() : "", bx, by + 42);
  ctx.textAlign = "left";

  // Name and details on the left.
  ctx.fillStyle = "#7a4b17";
  ctx.font = "34px Poppins ExtraBold";
  const nameLines = wrap(ctx, name.toUpperCase(), 230).slice(0, 3);
  nameLines.forEach((l, i) => ctx.fillText(l, 60, 820 + i * 40));
  ctx.fillStyle = "#a86f2c";
  ctx.font = "22px Poppins";
  const after = 820 + nameLines.length * 40;
  ctx.fillText("Birthday Celebration", 60, after + 6);
  ctx.fillText(dateLabel, 60, after + 36);
  ctx.strokeStyle = "#c39255";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, after + 56);
  ctx.lineTo(250, after + 56);
  ctx.stroke();

  // Wish on the right.
  ctx.fillStyle = "#a86f2c";
  ctx.textAlign = "right";
  // Room for six lines at full size; smaller text gets more lines in the same space.
  const step = (size: number) => Math.round(size * 1.46);
  const { lines, size } = fitWish(ctx, wish, "Poppins", 26, 17, 270, (sz) => Math.floor(228 / step(sz)));
  const end = 1010 + lines.length * step(size);
  lines.forEach((l, i) => ctx.fillText(l, W - 50, 1010 + i * step(size)));
  ctx.beginPath();
  ctx.moveTo(W - 50, end - 14);
  ctx.lineTo(W - 250, end - 14);
  ctx.stroke();
  ctx.font = "22px Poppins SemiBold";
  ctx.fillText(`— ${groupName}`, W - 50, end + 24);
  ctx.textAlign = "left";
  creditLine(ctx, credit, "rgba(122,75,23,0.7)");
  return c.encode("jpeg", 90);
}

// ---------- 4. Calendar: the birthday circled on its month ----------

export async function renderCalendar({
  photo,
  cutout,
  name,
  dateLabel,
  groupName,
  credit,
  year,
}: DesignInput): Promise<Buffer> {
  const c = createCanvas(W, H),
    ctx = c.getContext("2d");
  const RED = "#e3170a";
  const bg = ctx.createRadialGradient(W / 2, 600, 50, W / 2, 600, 900);
  bg.addColorStop(0, "#fbfbfb");
  bg.addColorStop(1, "#e6e6e6");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const d = parseDate(dateLabel) ?? { day: 1, month: 0 };
  const now = new Date();
  const y = year ?? now.getFullYear();

  balloon(ctx, 860, 120, 62, "#ff6a00", "#a83200", { blur: 2 });
  balloon(ctx, 80, 470, 70, "#ff3b1f", "#8a1200", { blur: 5 });
  balloon(ctx, 1030, 1180, 80, "#ff3b1f", "#8a1200", { blur: 8 });
  balloon(ctx, 150, 1260, 90, "#ffa200", "#a85a00", { blur: 10 });
  balloon(ctx, 1010, 520, 50, "#ffa200", "#a85a00", { blur: 6 });

  ctx.textAlign = "center";
  ctx.save();
  ctx.translate(W / 2 + 40, 120);
  ctx.rotate(-0.06);
  ctx.fillStyle = "#1d1d1d";
  ctx.font = "130px Great Vibes";
  ctx.fillText("happy", 0, 0);
  ctx.restore();
  ctx.fillStyle = RED;
  ctx.font = "140px Poppins ExtraBold";
  ctx.fillText("BIRTHDAY", W / 2, 250);
  ctx.font = "48px Poppins ExtraBold";
  spaced(ctx, MONTHS[d.month].toUpperCase(), W / 2, 330, 4, "center");

  // Photo rising from the bottom, behind the lower rows of the grid.
  if (cutout) {
    withShadow(ctx, personLayer(await loadImage(cutout), 640, 760, 1), (W - 640) / 2, H - 760, "rgba(0,0,0,0.2)");
  } else if (photo) {
    const img = await loadImage(photo);
    const layer = fadedPhoto(img, 600, 760, [fadeSides(0.16), fadeTop(0.02, 0.3)], 0.5, 0.2);
    ctx.drawImage(layer, (W - 600) / 2, H - 760);
  }

  // Month grid, Sunday first. A soft white halo keeps numbers readable over the photo.
  ctx.shadowColor = "rgba(255,255,255,0.95)";
  ctx.shadowBlur = 10;
  const cols = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"],
    x0 = 150,
    colW = 130,
    rowH = 92,
    top = 410;
  ctx.font = "38px Poppins SemiBold";
  cols.forEach((t, i) => {
    ctx.fillStyle = i === 0 ? RED : "#1d1d1d";
    ctx.fillText(t, x0 + i * colW, top);
  });
  const first = new Date(y, d.month, 1).getDay();
  const days = new Date(y, d.month + 1, 0).getDate();
  const cell = (n: number): [number, number] => {
    const idx = first + n - 1;
    return [x0 + (idx % 7) * colW, top + rowH * (1 + Math.floor(idx / 7))];
  };
  ctx.font = "40px Poppins SemiBold";
  for (let n = 1; n <= days; n++) {
    const [x, yy] = cell(n);
    ctx.fillStyle = (first + n - 1) % 7 === 0 ? RED : "#1d1d1d";
    ctx.fillText(String(n), x, yy);
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // The birthday, redrawn on top and circled by hand.
  const [bx, byy] = cell(d.day);
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(bx, byy - 14, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = RED;
  ctx.font = "44px Poppins ExtraBold";
  ctx.fillText(String(d.day), bx, byy);
  ctx.strokeStyle = RED;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(bx, byy - 14, 50, 42, -0.3, 0.3, Math.PI * 2 + 0.05);
  ctx.stroke();
  ctx.restore();

  // Name banner across the bottom.
  ctx.save();
  ctx.fillStyle = RED;
  ctx.font = "44px Poppins ExtraBold";
  const label = name.toUpperCase();
  fitFont(ctx, label, "Poppins ExtraBold", 44, 26, 860);
  const tw = ctx.measureText(label).width;
  ctx.beginPath();
  ctx.roundRect(W / 2 - tw / 2 - 30, 1196, tw + 60, 70, 35);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, W / 2, 1245);
  ctx.restore();
  ctx.fillStyle = "#1d1d1d";
  ctx.font = "22px Poppins SemiBold";
  ctx.shadowColor = "#fff";
  ctx.shadowBlur = 8;
  ctx.fillText(groupName, W / 2, 1306);
  ctx.shadowColor = "transparent";
  ctx.textAlign = "left";
  creditLine(ctx, credit, "rgba(29,29,29,0.8)", "center", W / 2, "#ffffff");
  return c.encode("jpeg", 90);
}

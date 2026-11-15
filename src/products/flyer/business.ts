// Business flyers, made in the owner app: a shop's products (photo, name and,
// if the owner wants, the price) on one of six designs, with the logo, the
// business name and the WhatsApp number to order on. Prices arrive already
// worked out from the price list and formatted: this file only draws them.
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { drawCredit } from "./credit.js";
import { balloon, bokeh, cover, fitFont, GOLD, H, metal, rng, sparkle, W, wrap } from "./designs4.js";
import { roundRect } from "./designs7.js";
import { loadFonts } from "./render.js";

type Ctx = SKRSContext2D;

export interface BusinessItem {
  photo?: Uint8Array;
  name?: string;
  /** The price as shown, e.g. "₦4,500". Left out when prices are hidden. */
  price?: string;
  /** The price is the lowest of several ("from ₦4,500"). */
  from?: boolean;
}

export interface BusinessFlyerInput {
  headline: string;
  subline?: string;
  items: BusinessItem[];
  businessName: string;
  logo?: Uint8Array;
  /** e.g. { label: "Order on WhatsApp", number: "0704 897 1600" } */
  contact?: { label: string; number: string };
  /** The shop page's address, shown under the business name. */
  link?: string;
  /** The word before a lowest price, e.g. "from". */
  fromWord: string;
  /** The business's colour, e.g. "#e8541e". */
  accent: string;
  credit?: string;
  /** Where to find the business, e.g. "Stand 14, Christmas Unplugged, Uyo". */
  place?: string;
  /** The language of the greeting on a seasonal design. */
  lang?: "en" | "fr";
  /** The year a New Year flyer welcomes; left out, the coming one. */
  year?: number;
  /** The owner's own touches from the design console. Left out, each design keeps its own look. */
  look?: FlyerLook;
}

/** Fonts the owner can pick for the headline; "upper" ones are written in capitals. */
export const HEADLINE_FONTS = [
  { id: "tall", name: "Tall", family: '"Anton"', upper: true, lead: 1.05 },
  { id: "modern", name: "Modern", family: '"Poppins ExtraBold"', upper: false, lead: 1.12 },
  { id: "elegant", name: "Elegant", family: '"Playfair Display Black"', upper: false, lead: 1.12 },
  { id: "script", name: "Script", family: '"Pacifico"', upper: false, lead: 1.35 },
  { id: "marker", name: "Marker", family: '"Permanent Marker"', upper: false, lead: 1.15 },
] as const;

export type HeadlineFont = (typeof HEADLINE_FONTS)[number]["id"];

export interface FlyerLook {
  /** The headline font; left out, the design's own. */
  font?: HeadlineFont;
  /** Headline size against the design's own, 0.85 to 1.15. */
  size?: number;
  /** Where the photo sits in its frame, 0 (left/top) to 1 (right/bottom). */
  photoX?: number;
  photoY?: number;
  /** 1 fills the frame; up to 2 goes in closer. */
  zoom?: number;
}

export function isHeadlineFont(id: string): id is HeadlineFont {
  return HEADLINE_FONTS.some((f) => f.id === id);
}

export const BUSINESS_DESIGNS = [
  { id: "spotlight", name: "Spotlight", about: "One product with a big photo and a price badge", max: 1 },
  { id: "grid", name: "Grid", about: "Two to four products on cards", max: 4 },
  { id: "menu", name: "Menu", about: "A price list with small photos, good for food and services", max: 8 },
  { id: "bold", name: "Bold", about: "Loud colour and a price sticker, for offers", max: 1 },
  { id: "snapshots", name: "Snapshots", about: "Up to three products as instant photos", max: 3 },
  { id: "glass", name: "Glass", about: "One product on frosted glass", max: 1 },
  { id: "christmas", name: "Christmas", about: "Red and gold, with your products as baubles", max: 4, season: true },
  { id: "lights", name: "Christmas lights", about: "Fairy lights on deep green", max: 4, season: true },
  { id: "newyear", name: "New Year", about: "Gold fireworks for the new year", max: 4, season: true },
] as const;

/** Seasonal designs keep their own colours and work with no products, as a greeting from the business. */
export function isSeasonal(id: BusinessDesign): boolean {
  return BUSINESS_DESIGNS.some((d) => d.id === id && "season" in d);
}

/** Christmas and New Year designs are offered from 1 November to 15 January. */
export function inSeason(now: Date): boolean {
  const m = now.getUTCMonth();
  return m === 10 || m === 11 || (m === 0 && now.getUTCDate() <= 15);
}

export type BusinessDesign = (typeof BUSINESS_DESIGNS)[number]["id"];

export function isBusinessDesign(id: string): id is BusinessDesign {
  return BUSINESS_DESIGNS.some((d) => d.id === id);
}

/** The largest number of products a design shows; the rest are left off. */
export function designMax(id: BusinessDesign): number {
  return BUSINESS_DESIGNS.find((d) => d.id === id)!.max;
}

const FOOT = 150;

export async function renderBusinessFlyer(design: BusinessDesign, input: BusinessFlyerInput): Promise<Buffer> {
  loadFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const items = input.items.slice(0, designMax(design));
  if (!items.length && !isSeasonal(design)) items.push({});
  const photos = await Promise.all(items.map((item) => picture(item, input.accent)));
  await DRAW[design](ctx, input, items, photos);
  drawCredit(ctx, input.credit, W, H - FOOT + 2);
  return canvas.encode("jpeg", 90);
}

/** A photo from the owner, made no bigger than 1600 pixels across so drafts stay small. */
export async function shrinkPhoto(data: Uint8Array): Promise<Buffer> {
  const img = await loadImage(Buffer.from(data));
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = createCanvas(Math.round(img.width * s), Math.round(img.height * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.encode("jpeg", 88);
}

/** A smaller copy of a finished flyer, for the page that shows every design at once. `mark` writes "Preview" across it. */
export async function previewOf(jpeg: Uint8Array, mark = false, width = 540): Promise<Buffer> {
  const img = await loadImage(Buffer.from(jpeg));
  const c = createCanvas(width, Math.round((img.height * width) / img.width));
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (mark) {
    loadFonts();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(-0.5);
    ctx.font = `${Math.round(width * 0.2)}px "Poppins ExtraBold"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.strokeText("PREVIEW", 0, 0);
    ctx.fillText("PREVIEW", 0, 0);
  }
  return c.encode("jpeg", 80);
}

type Draw = (ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>) => Promise<void> | void;

const DRAW: Record<BusinessDesign, Draw> = { spotlight, grid, menu, bold, snapshots, glass, christmas, lights, newyear };

// ---------- 1. Spotlight: the photo on a slant, headline and a round price badge ----------

async function spotlight(ctx: Ctx, input: BusinessFlyerInput, [item]: BusinessItem[], [photo]: Array<Image | Canvas>) {
  const PH = 840;
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, PH - 110);
  ctx.lineTo(0, PH);
  ctx.closePath();
  ctx.clip();
  place(ctx, input.look, photo!, 0, 0, W, PH);
  ctx.restore();
  ctx.fillStyle = input.accent;
  ctx.beginPath();
  ctx.moveTo(0, PH);
  ctx.lineTo(W, PH - 110);
  ctx.lineTo(W, PH - 96);
  ctx.lineTo(0, PH + 14);
  ctx.closePath();
  ctx.fill();
  await logoTile(ctx, input.logo, 48, 48, 120);
  if (item!.price) priceBadge(ctx, item!, input, W - 190, PH - 170, 125, -8);

  let y = PH + 46;
  const head = headlineFit(ctx, input, "tall", 1.08, input.subline ? 120 : 140, 64, W - 120, 1);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = readableOn("#141414", input.accent);
  for (const line of head.lines) {
    ctx.fillText(line, 60, y);
    y += head.step;
  }
  if (item!.name) {
    ctx.fillStyle = "#ffffff";
    fitFont(ctx, item!.name, '"Poppins SemiBold"', 46, 28, W - 120);
    ctx.fillText(item!.name, 60, y + 4);
    y += 64;
  }
  if (input.subline) {
    ctx.fillStyle = "#b8b8b8";
    ctx.font = `30px "Poppins"`;
    for (const line of wrap(ctx, input.subline, W - 120).slice(0, 2)) {
      ctx.fillText(line, 60, y + 4);
      y += 40;
    }
  }
  footer(ctx, input, { text: "#ffffff", muted: "#9a9a9a", rule: "#2c2c2c" });
}

// ---------- 2. Grid: a colour band with the headline, products on white cards ----------

async function grid(ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>) {
  ctx.fillStyle = "#f6f4ef";
  ctx.fillRect(0, 0, W, H);
  const on = inkOn(input.accent);
  const textW = W - 100 - (input.logo ? 120 : 0);
  const head = headlineFit(ctx, input, "tall", 1.05, 110, 60, textW, 2);
  const band = 50 + head.lines.length * head.step + (input.subline ? 56 : 0) + 40;
  ctx.fillStyle = input.accent;
  ctx.fillRect(0, 0, W, band);
  await logoTile(ctx, input.logo, W - 50 - 96, 40, 96);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = on;
  ctx.font = `${head.size}px ${head.family}`;
  let y = 50;
  for (const line of head.lines) {
    ctx.fillText(line, 50, y);
    y += head.step;
  }
  if (input.subline) {
    ctx.globalAlpha = 0.85;
    ctx.font = `30px "Poppins"`;
    ctx.fillText(wrap(ctx, input.subline, textW)[0] ?? "", 50, y + 6);
    ctx.globalAlpha = 1;
  }

  const top = band + 30,
    bottom = H - FOOT - 30,
    left = 50,
    gap = 24;
  const fullW = W - left * 2,
    fullH = bottom - top;
  const half = (fullW - gap) / 2;
  const slots: Array<[number, number, number, number]> =
    items.length === 1
      ? [[left, top, fullW, fullH]]
      : items.length === 2
        ? [
            [left, top, half, fullH],
            [left + half + gap, top, half, fullH],
          ]
        : items.length === 3
          ? [
              [left, top, fullW, fullH * 0.52],
              [left, top + fullH * 0.52 + gap, half, fullH * 0.48 - gap],
              [left + half + gap, top + fullH * 0.52 + gap, half, fullH * 0.48 - gap],
            ]
          : [0, 1, 2, 3].map((i) => [left + (i % 2) * (half + gap), top + Math.floor(i / 2) * ((fullH - gap) / 2 + gap), half, (fullH - gap) / 2]);
  const priceColour = readableOn("#ffffff", input.accent);
  items.forEach((item, i) => {
    const [x, y0, w, h] = slots[i]!;
    const words = item.name || item.price ? 112 : 0;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.12)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, x, y0, w, h, 26);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, x + 12, y0 + 12, w - 24, h - 24 - words, 18);
    ctx.clip();
    place(ctx, input.look, photos[i]!, x + 12, y0 + 12, w - 24, h - 24 - words);
    ctx.restore();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const ty = y0 + h - words;
    if (item.name) {
      ctx.fillStyle = "#151515";
      fitFont(ctx, item.name, '"Poppins SemiBold"', 32, 20, w - 44);
      ctx.fillText(item.name, x + 22, ty + 4);
    }
    if (item.price) {
      ctx.fillStyle = priceColour;
      const text = priceLine(item, input.fromWord);
      fitFont(ctx, text, '"Inter ExtraBold"', 36, 22, w - 44);
      ctx.fillText(text, x + 22, ty + (item.name ? 48 : 26));
    }
  });
  footer(ctx, input, { text: "#151515", muted: "#6b6b6b", rule: "#e2ded5" });
}

// ---------- 3. Menu: a dark price list with round photos and dotted leaders ----------

async function menu(ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>) {
  ctx.fillStyle = "#17120f";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 0, 40, W / 2, 0, 760);
  glow.addColorStop(0, withAlpha(input.accent, 0.35));
  glow.addColorStop(1, withAlpha(input.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const bright = readableOn("#17120f", input.accent);

  let y = 60;
  if (input.logo) {
    await logoTile(ctx, input.logo, W / 2 - 45, y, 90);
    y += 110;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  const head = headlineFit(ctx, input, "elegant", 1.12, 96, 54, W - 140, 2);
  for (const line of head.lines) {
    ctx.fillText(line, W / 2, y);
    y += head.step;
  }
  if (input.subline) {
    ctx.fillStyle = bright;
    ctx.font = `30px "Poppins"`;
    ctx.fillText(wrap(ctx, input.subline, W - 140)[0] ?? "", W / 2, y + 2);
    y += 46;
  }
  y += 18;
  ctx.fillStyle = withAlpha(bright, 0.6);
  ctx.fillRect(W / 2 - 60, y, 120, 3);
  y += 30;

  const bottom = H - FOOT - 24;
  const rowH = Math.min(150, (bottom - y) / items.length);
  y += (bottom - y - rowH * items.length) / 2;
  const thumb = rowH - 24;
  const nameSize = Math.min(42, Math.round(rowH * 0.32));
  items.forEach((item, i) => {
    const top = y + i * rowH;
    const cy = top + rowH / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(70 + thumb / 2, cy, thumb / 2, 0, Math.PI * 2);
    ctx.clip();
    place(ctx, input.look, photos[i]!, 70, cy - thumb / 2, thumb, thumb);
    ctx.restore();
    ctx.strokeStyle = withAlpha(bright, 0.8);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(70 + thumb / 2, cy, thumb / 2, 0, Math.PI * 2);
    ctx.stroke();

    const textX = 70 + thumb + 30;
    const right = W - 70;
    ctx.textBaseline = "middle";
    let priceW = 0;
    if (item.price) {
      ctx.textAlign = "right";
      ctx.fillStyle = bright;
      const text = priceLine(item, input.fromWord);
      fitFont(ctx, text, '"Inter ExtraBold"', nameSize, 18, 340);
      priceW = ctx.measureText(text).width;
      ctx.fillText(text, right, cy);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    const nameMax = right - textX - (priceW ? priceW + 40 : 0);
    const name = item.name ?? "";
    fitFont(ctx, name, '"Poppins SemiBold"', nameSize, 18, nameMax);
    ctx.fillText(name, textX, cy);
    if (item.price) {
      const from = textX + ctx.measureText(name).width + 16;
      const to = right - priceW - 16;
      ctx.fillStyle = withAlpha("#ffffff", 0.35);
      for (let x = from; x < to; x += 16) ctx.fillRect(x, cy + nameSize * 0.3, 5, 5);
    }
  });
  footer(ctx, input, { text: "#ffffff", muted: "#a8a29e", rule: "#2e2622" });
}

// ---------- 4. Bold: colour with halftone dots, a tilted photo and a price sticker ----------

async function bold(ctx: Ctx, input: BusinessFlyerInput, [item]: BusinessItem[], [photo]: Array<Image | Canvas>) {
  const on = inkOn(input.accent);
  ctx.fillStyle = input.accent;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = withAlpha(on === "#ffffff" ? "#000000" : "#ffffff", 0.12);
  for (let y = 0; y < H; y += 34) {
    for (let x = (y / 34) % 2 ? 17 : 0; x < W; x += 34) {
      const r = 2 + 9 * Math.max(0, (x + y) / (W + H) - 0.25);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.save();
  ctx.translate(W / 2, 60);
  ctx.rotate(-0.06);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const head = headlineFit(ctx, input, "tall", 1.02, 150, 70, W - 140, 2);
  let y = 0;
  for (const line of head.lines) {
    ctx.lineWidth = 12;
    ctx.lineJoin = "round";
    ctx.strokeStyle = on === "#ffffff" ? "#111111" : "#ffffff";
    ctx.strokeText(line, 0, y);
    ctx.fillStyle = on;
    ctx.fillText(line, 0, y);
    y += head.step;
  }
  if (input.subline) {
    ctx.font = `34px "Poppins SemiBold"`;
    ctx.fillStyle = on;
    ctx.fillText(wrap(ctx, input.subline, W - 160)[0] ?? "", 0, y + 10);
    y += 50;
  }
  ctx.restore();

  const frameTop = Math.max(60 + y + 40, 380);
  const frameH = H - FOOT - 70 - frameTop;
  const frameW = Math.min(720, frameH * 0.95);
  ctx.save();
  ctx.translate(W / 2 - 40, frameTop + frameH / 2);
  ctx.rotate(0.04);
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-frameW / 2, -frameH / 2, frameW, frameH);
  ctx.shadowColor = "transparent";
  coverIn(ctx, input.look, photo!, -frameW / 2 + 18, -frameH / 2 + 18, frameW - 36, frameH - 36);
  if (item!.name) {
    ctx.font = `40px "Poppins ExtraBold"`;
    fitFont(ctx, item!.name.toUpperCase(), '"Poppins ExtraBold"', 40, 22, frameW - 60);
    const tw = ctx.measureText(item!.name.toUpperCase()).width;
    ctx.fillStyle = "#111111";
    ctx.fillRect(-frameW / 2 - 20, frameH / 2 - 92, tw + 50, 70);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(item!.name.toUpperCase(), -frameW / 2 + 5, frameH / 2 - 56);
  }
  ctx.restore();

  if (item!.price) {
    const sticker = on === "#ffffff" ? "#ffd400" : "#111111";
    ctx.save();
    ctx.translate(W - 210, frameTop + frameH * 0.72);
    ctx.rotate(-0.18);
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 20;
    ctx.fillStyle = sticker;
    burst(ctx, 0, 0, 160, 134, 18);
    ctx.fill();
    ctx.restore();
    priceText(ctx, item!, input.fromWord, W - 210, frameTop + frameH * 0.72, 210, inkOn(sticker), -0.18);
  }
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, H - FOOT, W, FOOT);
  footer(ctx, input, { text: "#ffffff", muted: "#a3a3a3" });
}

// ---------- 5. Snapshots: instant photos on paper, names written in marker ----------

async function snapshots(ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>) {
  ctx.fillStyle = "#f1e9dc";
  ctx.fillRect(0, 0, W, H);
  const rand = rng(input.businessName + input.headline);
  for (let i = 0; i < 7; i++) {
    const x = rand() * W,
      y = rand() * (H - FOOT),
      r = 200 + rand() * 260;
    const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, withAlpha(input.accent, 0.16));
    blob.addColorStop(1, withAlpha(input.accent, 0));
    ctx.fillStyle = blob;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const ink = "#2a1f17";
  await logoTile(ctx, input.logo, W - 50 - 90, 44, 90);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = ink;
  const head = headlineFit(ctx, input, "script", 1.35, 96, 50, W - (input.logo ? 300 : 140), 2);
  let y = 40;
  for (const line of head.lines) {
    ctx.fillText(line, W / 2, y);
    y += head.step;
  }
  if (input.subline) {
    ctx.fillStyle = "#6b5a4a";
    ctx.font = `30px "Poppins"`;
    ctx.fillText(wrap(ctx, input.subline, W - 160)[0] ?? "", W / 2, y);
    y += 44;
  }

  const top = Math.max(y + 40, 300),
    bottom = H - FOOT - 40;
  const room = bottom - top;
  const spots: Array<[number, number, number, number]> =
    items.length === 1
      ? [[W / 2, top + room / 2, Math.min(640, room * 0.84), -0.04]]
      : items.length === 2
        ? [
            [295, top + room * 0.46, 470, -0.07],
            [785, top + room * 0.54, 470, 0.06],
          ]
        : [
            [235, top + room * 0.25, 350, -0.06],
            [845, top + room * 0.27, 350, 0.05],
            [540, top + room * 0.75, 350, -0.02],
          ];
  items.forEach((item, i) => {
    const [cx, cy, w, angle] = spots[i]!;
    const border = w * 0.05,
      chin = item.name ? w * 0.2 : border * 2;
    const h = Math.min(w + chin, room * 0.98);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(40,25,10,0.3)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.shadowColor = "transparent";
    coverIn(ctx, input.look, photos[i]!, -w / 2 + border, -h / 2 + border, w - border * 2, h - border - chin);
    ctx.fillStyle = "rgba(226,214,186,0.85)";
    ctx.save();
    ctx.rotate(-angle * 2);
    ctx.fillRect(-w * 0.16, -h / 2 - 22, w * 0.32, 44);
    ctx.restore();
    if (item.name) {
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      fitFont(ctx, item.name, '"Permanent Marker"', Math.round(chin * 0.42), 16, w - border * 4);
      ctx.fillText(item.name, 0, h / 2 - chin / 2);
    }
    ctx.restore();
    if (item.price) {
      const r = items.length === 1 ? 100 : 80;
      const px = Math.min(W - r - 16, cx + Math.cos(angle) * (w / 2 - 16) - Math.sin(angle) * (-h / 2 + 30));
      const py = cy + Math.sin(angle) * (w / 2 - 16) + Math.cos(angle) * (-h / 2 + 30);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.2)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = input.accent;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      priceText(ctx, item, input.fromWord, px, py, r * 1.6, inkOn(input.accent), angle + 0.12);
    }
  });
  footer(ctx, input, { text: ink, muted: "#7a6857", rule: "#ddd0bb" });
}

// ---------- 6. Glass: the photo blurred behind a frosted card ----------

async function glass(ctx: Ctx, input: BusinessFlyerInput, [item]: BusinessItem[], [photo]: Array<Image | Canvas>) {
  ctx.save();
  ctx.filter = "blur(36px)";
  cover(ctx, photo!, -80, -80, W + 160, H + 160, 0.5, 0.5);
  ctx.restore();
  ctx.fillStyle = "rgba(10,10,14,0.42)";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.15, 20, W * 0.85, H * 0.15, 520);
  glow.addColorStop(0, withAlpha(input.accent, 0.55));
  glow.addColorStop(1, withAlpha(input.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  await logoTile(ctx, input.logo, W - 60 - 88, 56, 88);
  const head = headlineFit(ctx, input, "modern", 1.12, 84, 46, W - 120 - (input.logo ? 110 : 0), 2);
  let y = 56;
  for (const line of head.lines) {
    ctx.fillText(line, 60, y);
    y += head.step;
  }
  if (input.subline) {
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = `30px "Poppins"`;
    ctx.fillText(wrap(ctx, input.subline, W - 120)[0] ?? "", 60, y + 4);
    y += 46;
  }

  const cardTop = Math.max(y + 36, 260),
    cardBottom = H - FOOT - 30;
  const x = 60,
    w = W - 120,
    h = cardBottom - cardTop;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 50;
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  roundRect(ctx, x, cardTop, w, h, 40);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;
  roundRect(ctx, x, cardTop, w, h, 40);
  ctx.stroke();
  const words = item!.name || item!.price ? 130 : 0;
  ctx.save();
  roundRect(ctx, x + 26, cardTop + 26, w - 52, h - 52 - words, 26);
  ctx.clip();
  place(ctx, input.look, photo!, x + 26, cardTop + 26, w - 52, h - 52 - words);
  ctx.restore();
  const midY = cardBottom - 26 - words / 2;
  let priceW = 0;
  if (item!.price) {
    const text = priceLine(item!, input.fromWord);
    fitFont(ctx, text, '"Inter ExtraBold"', 40, 24, 380);
    priceW = ctx.measureText(text).width + 56;
    ctx.fillStyle = input.accent;
    roundRect(ctx, x + w - 34 - priceW, midY - 38, priceW, 76, 38);
    ctx.fill();
    ctx.fillStyle = inkOn(input.accent);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w - 34 - priceW / 2, midY + 2);
  }
  if (item!.name) {
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    fitFont(ctx, item!.name, '"Poppins SemiBold"', 46, 24, w - 80 - priceW);
    ctx.fillText(item!.name, x + 40, midY);
  }
  footer(ctx, input, { text: "#ffffff", muted: "rgba(255,255,255,0.72)", rule: "rgba(255,255,255,0.25)" });
}

// ---------- 7 to 9. Seasonal: Christmas, Christmas lights and New Year ----------
// One layout under three backgrounds: a greeting in gold script, the headline,
// then the products (none, one big, or two to four round ones), where to find
// the business, and the footer. With no products the logo sits in a wreath.

interface Season {
  greeting: { en: string; fr: string };
  font: HeadlineFont;
  lead: number;
  /** Paints the background and the decorations at the top. */
  scene: (ctx: Ctx, input: BusinessFlyerInput) => void;
  /** The wreath around the logo when there are no products: leaves, or gold for New Year. */
  leaves: boolean;
  /** Where the words start, below the decorations. */
  top: number;
}

const RED = "#c8102e";
const PINE = ["#0f5132", "#1a6b43", "#2d8a57"];

const SEASONS: Record<"christmas" | "lights" | "newyear", Season> = {
  christmas: {
    greeting: { en: "Merry Christmas", fr: "Joyeux Noël" },
    font: "elegant",
    lead: 1.1,
    leaves: true,
    top: 150,
    scene(ctx, input) {
      const bg = ctx.createRadialGradient(W / 2, H * 0.4, 80, W / 2, H * 0.4, H * 0.85);
      bg.addColorStop(0, "#a3122a");
      bg.addColorStop(1, "#4a0612");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const rand = rng(`christmas${input.businessName}`);
      for (let i = 0; i < 40; i++) sparkle(ctx, rand() * W, rand() * (H - FOOT), 4 + rand() * 10, `rgba(255,226,150,${0.25 + rand() * 0.5})`);
      sprig(ctx, -20, 22, 0.1, 360);
      sprig(ctx, W + 20, 22, Math.PI - 0.1, 360);
      bauble(ctx, 70, 120, 34, "#f3cf6b", "#8a5a12");
      bauble(ctx, 160, 95, 22, "#ffffff", "#b9c2cc");
      bauble(ctx, W - 70, 125, 36, "#1a6b43", "#06301c");
      bauble(ctx, W - 160, 95, 22, "#f3cf6b", "#8a5a12");
    },
  },
  lights: {
    greeting: { en: "Season's Greetings", fr: "Joyeuses fêtes" },
    font: "modern",
    lead: 1.12,
    leaves: true,
    top: 140,
    scene(ctx, input) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0b3d2b");
      bg.addColorStop(1, "#04180f");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const rand = rng(`lights${input.businessName}`);
      bokeh(ctx, rand, 30, { x: 0, y: 0, w: W, h: H - FOOT }, ["rgba(255,200,90,0.9)", "rgba(255,120,80,0.7)", "rgba(255,240,200,0.8)"], 20, 70);
      fairyLights(ctx, rand, -40, 20, W + 40, 30, 150);
    },
  },
  newyear: {
    greeting: { en: "Happy New Year", fr: "Bonne année" },
    font: "tall",
    lead: 1.04,
    leaves: false,
    top: 70,
    scene(ctx, input) {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, "#1b1446");
      bg.addColorStop(1, "#05040f");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.font = `520px "Anton"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(243,207,107,0.13)";
      ctx.lineWidth = 4;
      ctx.strokeText(String(input.year ?? comingYear(new Date())), W / 2, H * 0.52);
      ctx.restore();
      const rand = rng(`newyear${input.businessName}`);
      firework(ctx, rand, 150, 150, 120, "#f3cf6b");
      firework(ctx, rand, W - 150, 120, 140, "#ff7ab6");
      firework(ctx, rand, W - 70, 420, 70, "#f3cf6b");
      for (let i = 0; i < 90; i++) {
        ctx.save();
        ctx.translate(rand() * W, rand() * (H - FOOT));
        ctx.rotate(rand() * Math.PI);
        ctx.fillStyle = ["#f3cf6b", "#ff7ab6", "#ffffff", "#7ad7ff"][Math.floor(rand() * 4)]!;
        ctx.globalAlpha = 0.35 + rand() * 0.45;
        ctx.fillRect(-7, -3, 14, 6);
        ctx.restore();
      }
    },
  },
};

/** Before 15 January the year just begun, otherwise the one coming. */
export function comingYear(now: Date): number {
  return now.getUTCMonth() === 0 ? now.getUTCFullYear() : now.getUTCFullYear() + 1;
}

function christmas(ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>) {
  return seasonal(ctx, input, items, photos, SEASONS.christmas);
}
function lights(ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>) {
  return seasonal(ctx, input, items, photos, SEASONS.lights);
}
function newyear(ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>) {
  return seasonal(ctx, input, items, photos, SEASONS.newyear);
}

async function seasonal(ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>, season: Season) {
  season.scene(ctx, input);
  const gold = (y0: number, y1: number) => metal(ctx, y0, y1, GOLD);
  let y = season.top;
  if (input.logo && items.length) {
    await logoTile(ctx, input.logo, W / 2 - 44, y, 88);
    y += 104;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const greeting = season.greeting[input.lang ?? "en"];
  const gSize = fitFont(ctx, greeting, '"Great Vibes"', 104, 60, W - 420);
  ctx.fillStyle = gold(y, y + gSize);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 12;
  ctx.fillText(greeting, W / 2, y);
  ctx.shadowColor = "transparent";
  y += gSize * 1.2;
  ctx.fillStyle = "#ffffff";
  const head = headlineFit(ctx, input, season.font, season.lead, items.length ? 92 : 110, 50, W - 160, 2);
  for (const line of head.lines) {
    ctx.fillText(line, W / 2, y);
    y += head.step;
  }
  if (input.subline) {
    ctx.fillStyle = "rgba(255,244,220,0.85)";
    ctx.font = `30px "Poppins"`;
    for (const line of wrap(ctx, input.subline, W - 160).slice(0, 2)) {
      ctx.fillText(line, W / 2, y + 6);
      y += 42;
    }
  }

  const bottom = H - FOOT - (input.place ? 112 : 36);
  const top = y + 36;
  if (!items.length) await wreath(ctx, input, W / 2, (top + bottom) / 2, Math.min(230, (bottom - top) / 2 - 20), season.leaves);
  else if (items.length === 1) onePhoto(ctx, input, items[0]!, photos[0]!, top, bottom);
  else roundPhotos(ctx, input, items, photos, top, bottom);

  if (input.place) placePill(ctx, input.place, H - FOOT - 86);
  footer(ctx, { ...input, place: undefined }, { text: "#ffffff", muted: "rgba(255,244,220,0.7)", rule: "rgba(243,207,107,0.45)" });
}

/** One product: its photo in a gold frame, the name under it and the price on a gold tag. */
function onePhoto(ctx: Ctx, input: BusinessFlyerInput, item: BusinessItem, photo: Image | Canvas, top: number, bottom: number) {
  const words = item.name ? 64 : 0;
  const h = bottom - top - words;
  const w = Math.min(W - 200, h * 1.1);
  const x = (W - w) / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = metal(ctx, top, top + h, GOLD);
  roundRect(ctx, x - 10, top - 10, w + 20, h + 20, 40);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, top, w, h, 32);
  ctx.clip();
  place(ctx, input.look, photo, x, top, w, h);
  ctx.restore();
  if (item.price) goldTag(ctx, priceLine(item, input.fromWord), x + w - 24, top + h - 64, true);
  if (item.name) {
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    fitFont(ctx, item.name, '"Poppins SemiBold"', 44, 26, W - 160);
    ctx.fillText(item.name, W / 2, top + h + 26);
  }
}

/** Two to four products as round photos in gold rings, like baubles on a string. */
function roundPhotos(ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>, top: number, bottom: number) {
  const rows = items.length === 4 ? 2 : 1;
  const perRow = items.length === 4 ? 2 : items.length;
  const rowH = (bottom - top) / rows;
  const words = items.some((i) => i.name || i.price) ? 96 : 0;
  const r = Math.min((W - 120) / perRow / 2 - 24, (rowH - words - 60) / 2);
  const gap = (rowH - (r * 2 + 30 + words)) / 2;
  items.forEach((item, i) => {
    const row = Math.floor(i / perRow);
    const cx = (W / (perRow * 2)) * ((i % perRow) * 2 + 1);
    const cy = top + row * rowH + gap + 30 + r;
    ctx.strokeStyle = "rgba(243,207,107,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, top + row * rowH - 30);
    ctx.lineTo(cx, cy - r - 22);
    ctx.stroke();
    ctx.fillStyle = metal(ctx, cy - r - 34, cy - r - 4, GOLD);
    roundRect(ctx, cx - r * 0.16, cy - r - 30, r * 0.32, 30, 6);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 30;
    ctx.fillStyle = metal(ctx, cy - r, cy + r, GOLD);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    place(ctx, input.look, photos[i]!, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const span = W / perRow - 40;
    let ty = cy + r + 22;
    if (item.name) {
      ctx.fillStyle = "#ffffff";
      fitFont(ctx, item.name, '"Poppins SemiBold"', 34, 20, span);
      ctx.fillText(item.name, cx, ty);
      ty += 46;
    }
    if (item.price) {
      ctx.fillStyle = metal(ctx, ty, ty + 36, GOLD);
      fitFont(ctx, priceLine(item, input.fromWord), '"Inter ExtraBold"', 36, 20, span);
      ctx.fillText(priceLine(item, input.fromWord), cx, ty);
    }
  });
}

/** No products: the logo, or the business's initials, inside a wreath. */
async function wreath(ctx: Ctx, input: BusinessFlyerInput, cx: number, cy: number, r: number, leaves: boolean) {
  const rand = rng(`wreath${input.businessName}`);
  if (leaves) {
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rand() * 0.1;
      const rr = r + (rand() - 0.5) * 34;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      ctx.rotate(a + Math.PI / 2 + (rand() - 0.5) * 1.2);
      ctx.fillStyle = PINE[Math.floor(rand() * PINE.length)]!;
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2;
      balloon(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 9, RED, "#6d0716", { string: false, oval: 1 });
    }
  } else {
    ctx.strokeStyle = metal(ctx, cy - r, cy + r, GOLD);
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      sparkle(ctx, cx + Math.cos(a) * (r + 40), cy + Math.sin(a) * (r + 40), 10 + rand() * 12, "#f3cf6b");
    }
  }
  const inner = r - 30;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fill();
  if (input.logo) {
    const img = await loadImage(Buffer.from(input.logo));
    const s = Math.min((inner * 1.3) / img.width, (inner * 1.3) / img.height);
    ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
  } else {
    const initials = input.businessName
      .split(/\s+/)
      .filter((w) => /\p{L}/u.test(w))
      .slice(0, 2)
      .map((w) => w.match(/\p{L}/u)![0]!.toUpperCase())
      .join("");
    ctx.fillStyle = "#4a0612";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    fitFont(ctx, initials, '"Playfair Display Black"', Math.round(inner * 0.9), 40, inner * 1.5);
    ctx.fillText(initials, cx, cy + 6);
  }
}

/** Where to find the business, on a gold-edged pill with a map pin. */
function placePill(ctx: Ctx, text: string, y: number) {
  fitFont(ctx, text, '"Poppins SemiBold"', 32, 20, W - 260);
  const w = ctx.measureText(text).width + 110;
  const x = (W - w) / 2;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, x, y, w, 64, 32);
  ctx.fill();
  ctx.strokeStyle = "rgba(243,207,107,0.8)";
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, 64, 32);
  ctx.stroke();
  const px = x + 42,
    py = y + 28;
  ctx.fillStyle = "#f3cf6b";
  ctx.beginPath();
  ctx.arc(px, py, 12, Math.PI, 0);
  ctx.lineTo(px, py + 22);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#3a2a08";
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 72, y + 33);
}

/** A price on a gold tag; `right` ends it at x instead of centring it there. */
function goldTag(ctx: Ctx, text: string, x: number, y: number, right = false) {
  fitFont(ctx, text, '"Inter ExtraBold"', 44, 24, 420);
  const w = ctx.measureText(text).width + 60;
  const left = right ? x - w : x - w / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = metal(ctx, y - 40, y + 40, GOLD);
  roundRect(ctx, left, y - 40, w, 80, 40);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#2a1a04";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + w / 2, y + 2);
}

/** A pine branch growing from a corner, with a few red berries. */
function sprig(ctx: Ctx, x: number, y: number, angle: number, length: number) {
  const rand = rng(`sprig${x}`);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = "#3b2414";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length, 0);
  ctx.stroke();
  for (let t = 0; t < length; t += 7) {
    const n = 30 * (1 - t / length) + 16;
    for (const side of [-1, 1]) {
      ctx.strokeStyle = PINE[Math.floor(rand() * PINE.length)]!;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(t, 0);
      ctx.lineTo(t + n * 0.55, side * n);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 4; i++) balloon(ctx, length * (0.35 + i * 0.12), (rand() - 0.5) * 24, 9, RED, "#6d0716", { string: false, oval: 1 });
  ctx.restore();
}

/** A Christmas bauble hanging from the top edge on a thin gold thread. */
function bauble(ctx: Ctx, x: number, y: number, r: number, base: string, dark: string) {
  ctx.strokeStyle = "rgba(243,207,107,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, y - r);
  ctx.stroke();
  ctx.fillStyle = metal(ctx, y - r - 14, y - r + 4, GOLD);
  ctx.fillRect(x - r * 0.22, y - r - 12, r * 0.44, 16);
  balloon(ctx, x, y, r, base, dark, { string: false, oval: 1 });
}

/** A string of glowing fairy lights hanging between two points. */
function fairyLights(ctx: Ctx, rand: () => number, x0: number, y0: number, x1: number, y1: number, sag: number) {
  const point = (t: number) => {
    const mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2 + sag;
    return [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t ** 2 * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t ** 2 * y1] as const;
  };
  ctx.strokeStyle = "#1d1d1d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let t = 0; t <= 1.001; t += 0.02) {
    const [px, py] = point(t);
    if (t === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  const colours = ["#ffd166", "#ff5a5f", "#3ddc97", "#5ab0ff", "#fff4d6"];
  const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 70);
  for (let i = 1; i < n; i++) {
    const [px, py] = point(i / n);
    const c = colours[Math.floor(rand() * colours.length)]!;
    const glow = ctx.createRadialGradient(px, py + 16, 0, px, py + 16, 46);
    glow.addColorStop(0, withAlpha(c, 0.55));
    glow.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(px - 46, py - 30, 92, 92);
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(px - 5, py - 2, 10, 10);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(px, py + 18, 8, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A firework: gold streaks bursting out from a point, with sparks at the ends. */
function firework(ctx: Ctx, rand: () => number, x: number, y: number, r: number, colour: string) {
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + rand() * 0.1;
    const len = r * (0.6 + rand() * 0.4);
    const g = ctx.createLinearGradient(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.addColorStop(0, withAlpha(colour, 0));
    g.addColorStop(1, withAlpha(colour, 0.95));
    ctx.strokeStyle = g;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.15);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * (len + 8), y + Math.sin(a) * (len + 8), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- Shared pieces ----------

/** The business at the bottom: logo, name and shop link on the left, the number to order on at the right. */
function footer(ctx: Ctx, input: BusinessFlyerInput, colours: { text: string; muted: string; rule?: string }) {
  const top = H - FOOT;
  if (colours.rule) {
    ctx.fillStyle = colours.rule;
    ctx.fillRect(50, top, W - 100, 2);
  }
  const mid = top + FOOT / 2;
  let right = W - 50;
  if (input.contact) {
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = colours.muted;
    ctx.font = `24px "Poppins"`;
    ctx.fillText(input.contact.label, right, mid - 14);
    ctx.fillStyle = colours.text;
    ctx.font = `44px "Poppins ExtraBold"`;
    ctx.fillText(input.contact.number, right, mid + 34);
    right -= Math.max(ctx.measureText(input.contact.number).width, 200) + 40;
  }
  const left = 50;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = colours.text;
  const second = input.place ?? input.link;
  fitFont(ctx, input.businessName, '"Poppins SemiBold"', 36, 20, right - left);
  ctx.fillText(input.businessName, left, second ? mid - 2 : mid + 12);
  if (second) {
    ctx.fillStyle = colours.muted;
    fitFont(ctx, second, '"Poppins"', 24, 16, right - left);
    ctx.fillText(second, left, mid + 36);
  }
}

/** The photo filling a box, with what spills over cut off. */
function coverIn(ctx: Ctx, look: FlyerLook | undefined, img: Image | Canvas, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  place(ctx, look, img, x, y, w, h);
  ctx.restore();
}

/** The photo filling a box (the caller clips it), moved and zoomed the way the owner set it in the console. */
function place(ctx: Ctx, look: FlyerLook | undefined, img: Image | Canvas, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height) * (look?.zoom ?? 1);
  const iw = img.width * s,
    ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) * (look?.photoX ?? 0.5), y + (h - ih) * (look?.photoY ?? 0.5), iw, ih);
}

/** The headline at the biggest size that fits, in the design's own font or the one the owner picked, made bigger or smaller as they set it. */
function headlineFit(ctx: Ctx, input: BusinessFlyerInput, own: HeadlineFont, lead: number, max: number, min: number, width: number, maxLines: number) {
  const picked = input.look?.font && input.look.font !== own ? HEADLINE_FONTS.find((f) => f.id === input.look!.font) : undefined;
  const font = picked ?? HEADLINE_FONTS.find((f) => f.id === own)!;
  const scale = input.look?.size ?? 1;
  const fit = fitLines(ctx, font.upper ? input.headline.toUpperCase() : input.headline, font.family, Math.round(max * scale), Math.round(min * scale), width, maxLines);
  return { ...fit, family: font.family, step: fit.size * (picked ? picked.lead : lead) };
}

/** The logo on a white rounded square, so any logo reads on any background. */
async function logoTile(ctx: Ctx, logo: Uint8Array | undefined, x: number, y: number, size: number) {
  if (!logo) return;
  const img = await loadImage(Buffer.from(logo));
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, size, size, size * 0.22);
  ctx.fill();
  ctx.restore();
  const pad = size * 0.12;
  const s = Math.min((size - pad * 2) / img.width, (size - pad * 2) / img.height);
  ctx.drawImage(img, x + (size - img.width * s) / 2, y + (size - img.height * s) / 2, img.width * s, img.height * s);
}

/** A round price badge with the price on it. */
function priceBadge(ctx: Ctx, item: BusinessItem, input: BusinessFlyerInput, cx: number, cy: number, r: number, degrees: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 30;
  ctx.fillStyle = input.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = withAlpha(inkOn(input.accent), 0.5);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 12, 0, Math.PI * 2);
  ctx.stroke();
  priceText(ctx, item, input.fromWord, cx, cy, r * 1.6, inkOn(input.accent), (degrees * Math.PI) / 180);
}

/** The price centred on a point, with "from" above it when it is the lowest of several. */
function priceText(ctx: Ctx, item: BusinessItem, fromWord: string, cx: number, cy: number, maxW: number, colour: string, angle: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = colour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = fitFont(ctx, item.price!, '"Anton"', Math.round(maxW * 0.42), 24, maxW);
  ctx.fillText(item.price!, 0, item.from ? size * 0.22 : 0);
  if (item.from) {
    ctx.font = `${Math.round(size * 0.36)}px "Poppins SemiBold"`;
    ctx.fillText(fromWord.toUpperCase(), 0, -size * 0.5);
  }
  ctx.restore();
}

function priceLine(item: BusinessItem, fromWord: string): string {
  return item.from ? `${fromWord} ${item.price}` : item.price!;
}

/** The biggest size, from max down to min, at which the text fits in maxLines lines. */
export function fitLines(ctx: Ctx, text: string, family: string, max: number, min: number, width: number, maxLines: number): { size: number; lines: string[] } {
  for (let size = max; size >= min; size -= 4) {
    ctx.font = `${size}px ${family}`;
    const lines = wrap(ctx, text, width);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= width)) return { size, lines };
  }
  ctx.font = `${min}px ${family}`;
  return { size: min, lines: wrap(ctx, text, width).slice(0, maxLines) };
}

/** The product's photo, or its first letter on the business colour when it has none. */
async function picture(item: BusinessItem, accent: string): Promise<Image | Canvas> {
  if (item.photo) {
    try {
      return await loadImage(Buffer.from(item.photo));
    } catch {
      // A broken photo gets the letter tile instead.
    }
  }
  const c = createCanvas(800, 800);
  const ctx = c.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, 800, 800);
  bg.addColorStop(0, accent);
  bg.addColorStop(1, shade(accent, 0.55));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 800, 800);
  ctx.fillStyle = withAlpha(inkOn(accent), 0.9);
  ctx.font = `360px "Poppins ExtraBold"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((item.name?.trim()[0] ?? "").toUpperCase(), 400, 420);
  return c;
}

function burst(ctx: Ctx, cx: number, cy: number, outer: number, inner: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 ? inner : outer;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Black or white, whichever reads better on the colour. */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.4 ? "#111111" : "#ffffff";
}

/** The colour itself when it stands out on the background, else a lighter or darker shade of it that does. */
function readableOn(background: string, colour: string): string {
  const contrast = (a: string, b: string) => {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (l1! + 0.05) / (l2! + 0.05);
  };
  if (contrast(background, colour) >= 3) return colour;
  const dark = luminance(background) > 0.4;
  for (let t = 0.2; t <= 1; t += 0.2) {
    const tried = dark ? shade(colour, t) : tint(colour, t);
    if (contrast(background, tried) >= 3) return tried;
  }
  return dark ? "#111111" : "#ffffff";
}

function mixWith(hex: string, target: number, t: number): string {
  return `#${rgb(hex)
    .map((v) => Math.round(v + (target - v) * t).toString(16).padStart(2, "0"))
    .join("")}`;
}

const shade = (hex: string, t: number) => mixWith(hex, 0, t);
const tint = (hex: string, t: number) => mixWith(hex, 255, t);

function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

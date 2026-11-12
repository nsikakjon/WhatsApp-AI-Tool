// Business flyers, made in the owner app: a shop's products (photo, name and,
// if the owner wants, the price) on one of six designs, with the logo, the
// business name and the WhatsApp number to order on. Prices arrive already
// worked out from the price list and formatted: this file only draws them.
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { drawCredit } from "./credit.js";
import { cover, fitFont, H, rng, W, wrap } from "./designs4.js";
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
}

export const BUSINESS_DESIGNS = [
  { id: "spotlight", name: "Spotlight", about: "One product with a big photo and a price badge", max: 1 },
  { id: "grid", name: "Grid", about: "Two to four products on cards", max: 4 },
  { id: "menu", name: "Menu", about: "A price list with small photos, good for food and services", max: 8 },
  { id: "bold", name: "Bold", about: "Loud colour and a price sticker, for offers", max: 1 },
  { id: "snapshots", name: "Snapshots", about: "Up to three products as instant photos", max: 3 },
  { id: "glass", name: "Glass", about: "One product on frosted glass", max: 1 },
] as const;

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
  if (!items.length) items.push({});
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

/** A smaller copy of a finished flyer, for the page that shows every design at once. */
export async function previewOf(jpeg: Uint8Array, width = 540): Promise<Buffer> {
  const img = await loadImage(Buffer.from(jpeg));
  const c = createCanvas(width, Math.round((img.height * width) / img.width));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.encode("jpeg", 80);
}

type Draw = (ctx: Ctx, input: BusinessFlyerInput, items: BusinessItem[], photos: Array<Image | Canvas>) => Promise<void> | void;

const DRAW: Record<BusinessDesign, Draw> = { spotlight, grid, menu, bold, snapshots, glass };

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
  cover(ctx, photo!, 0, 0, W, PH, 0.5, 0.5);
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
  const head = fitLines(ctx, input.headline.toUpperCase(), '"Anton"', input.subline ? 120 : 140, 64, W - 120, 1);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = readableOn("#141414", input.accent);
  for (const line of head.lines) {
    ctx.fillText(line, 60, y);
    y += head.size * 1.08;
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
  const head = fitLines(ctx, input.headline.toUpperCase(), '"Anton"', 110, 60, textW, 2);
  const band = 50 + head.lines.length * head.size * 1.05 + (input.subline ? 56 : 0) + 40;
  ctx.fillStyle = input.accent;
  ctx.fillRect(0, 0, W, band);
  await logoTile(ctx, input.logo, W - 50 - 96, 40, 96);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = on;
  ctx.font = `${head.size}px "Anton"`;
  let y = 50;
  for (const line of head.lines) {
    ctx.fillText(line, 50, y);
    y += head.size * 1.05;
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
    cover(ctx, photos[i]!, x + 12, y0 + 12, w - 24, h - 24 - words, 0.5, 0.5);
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
  const head = fitLines(ctx, input.headline, '"Playfair Display Black"', 96, 54, W - 140, 2);
  for (const line of head.lines) {
    ctx.fillText(line, W / 2, y);
    y += head.size * 1.12;
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
    cover(ctx, photos[i]!, 70, cy - thumb / 2, thumb, thumb, 0.5, 0.5);
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
  const head = fitLines(ctx, input.headline.toUpperCase(), '"Anton"', 150, 70, W - 140, 2);
  let y = 0;
  for (const line of head.lines) {
    ctx.lineWidth = 12;
    ctx.lineJoin = "round";
    ctx.strokeStyle = on === "#ffffff" ? "#111111" : "#ffffff";
    ctx.strokeText(line, 0, y);
    ctx.fillStyle = on;
    ctx.fillText(line, 0, y);
    y += head.size * 1.02;
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
  coverIn(ctx, photo!, -frameW / 2 + 18, -frameH / 2 + 18, frameW - 36, frameH - 36);
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
  const head = fitLines(ctx, input.headline, '"Pacifico"', 96, 50, W - (input.logo ? 300 : 140), 2);
  let y = 40;
  for (const line of head.lines) {
    ctx.fillText(line, W / 2, y);
    y += head.size * 1.35;
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
    coverIn(ctx, photos[i]!, -w / 2 + border, -h / 2 + border, w - border * 2, h - border - chin);
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
  const head = fitLines(ctx, input.headline, '"Poppins ExtraBold"', 84, 46, W - 120 - (input.logo ? 110 : 0), 2);
  let y = 56;
  for (const line of head.lines) {
    ctx.fillText(line, 60, y);
    y += head.size * 1.12;
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
  cover(ctx, photo!, x + 26, cardTop + 26, w - 52, h - 52 - words, 0.5, 0.5);
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
  fitFont(ctx, input.businessName, '"Poppins SemiBold"', 36, 20, right - left);
  ctx.fillText(input.businessName, left, input.link ? mid - 2 : mid + 12);
  if (input.link) {
    ctx.fillStyle = colours.muted;
    fitFont(ctx, input.link, '"Poppins"', 24, 16, right - left);
    ctx.fillText(input.link, left, mid + 36);
  }
}

/** The photo filling a box, with what spills over cut off. */
function coverIn(ctx: Ctx, img: Image | Canvas, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  cover(ctx, img, x, y, w, h, 0.5, 0.5);
  ctx.restore();
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

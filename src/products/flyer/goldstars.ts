// "Gold stars" birthday design: a warm gold card, a big round photo, the
// birthday wish beside it, foil balloon stars and glitter. Unlike the other
// designs it prints the wish on the flyer itself.
import type { Lang } from "../../core/i18n.js";
import { drawCredit } from "./credit.js";
import { fitWidth, flyerWords } from "./words.js";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";

export interface GoldStarsInput {
  photo: Uint8Array;
  name: string;
  dateLabel: string;
  groupName: string;
  /** The birthday message; **word** is set in bold. */
  wish?: string;
  logo?: Uint8Array;
  credit?: string;
  lang?: Lang;
}

/** Used on previews, before a real birthday message is written. */
export const SAMPLE_WISH =
  "Today we celebrate you! Wishing you a day full of **joy**, sweet surprises and **laughter** with the people who **love** you most.";
export const SAMPLE_WISH_FR =
  "Aujourd'hui, on te célèbre ! Nous te souhaitons une journée pleine de **joie**, de belles surprises et de **rires** avec ceux qui t'**aiment** le plus.";

const W = 1080,
  H = 1350;

// Small seeded random so the glitter is the same every time for the same name.
function rng(seed: string) {
  let s = 0;
  for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const PALETTES: Record<"gold" | "silver", { light: string; mid: string; dark: string; edge: string }> = {
  gold: { light: "#fff3c4", mid: "#e2a93b", dark: "#8a5a12", edge: "#b8801f" },
  silver: { light: "#ffffff", mid: "#c9ced6", dark: "#6c7380", edge: "#9aa1ad" },
};

// A five-point foil balloon star: ten facets, alternately lit and shaded, so it looks puffed up.
function foilStar(ctx: SKRSContext2D, cx: number, cy: number, R: number, rot: number, kind: "gold" | "silver") {
  const p = PALETTES[kind];
  const r = R * 0.5;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  ctx.save();
  ctx.shadowColor = "rgba(60,30,0,0.35)";
  ctx.shadowBlur = R * 0.25;
  ctx.shadowOffsetY = R * 0.08;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = R * 0.12;
  ctx.strokeStyle = p.edge;
  ctx.fillStyle = p.mid;
  ctx.stroke();
  ctx.fill();
  ctx.restore();

  for (let i = 0; i < 10; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % 10]!;
    const tip = i % 2 === 0 ? [x1, y1] : [x2, y2];
    // Light comes from the top left: facets facing it are bright, the others dark.
    const mx = (x1 + x2) / 2 - cx,
      my = (y1 + y2) / 2 - cy;
    const facing = (-mx - my) / Math.hypot(mx, my);
    const g = ctx.createLinearGradient(cx, cy, tip[0], tip[1]);
    if (facing > -0.2 && i % 2 === 0) {
      g.addColorStop(0, p.light);
      g.addColorStop(0.55, p.mid);
      g.addColorStop(1, p.light);
    } else if (facing > -0.2) {
      g.addColorStop(0, p.mid);
      g.addColorStop(1, p.light);
    } else if (i % 2 === 0) {
      g.addColorStop(0, p.mid);
      g.addColorStop(1, p.dark);
    } else {
      g.addColorStop(0, p.dark);
      g.addColorStop(0.6, p.mid);
      g.addColorStop(1, p.dark);
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
  }
  // Soft shine near the centre.
  const shine = ctx.createRadialGradient(cx - R * 0.15, cy - R * 0.2, 0, cx - R * 0.15, cy - R * 0.2, R * 0.45);
  shine.addColorStop(0, "rgba(255,255,255,0.55)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function glitter(
  ctx: SKRSContext2D,
  rand: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  count: number,
  colours: string[],
) {
  for (let i = 0; i < count; i++) {
    const px = x + rand() * w,
      py = y + rand() * h,
      s = rand() * 2.6 + 0.6;
    ctx.globalAlpha = 0.35 + rand() * 0.65;
    ctx.fillStyle = colours[Math.floor(rand() * colours.length)]!;
    ctx.beginPath();
    ctx.arc(px, py, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function grain(
  ctx: SKRSContext2D,
  rand: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  n: number,
  colour: string,
) {
  ctx.fillStyle = colour;
  for (let i = 0; i < n; i++) ctx.fillRect(x + rand() * w, y + rand() * h, 1.5, 1.5);
}

interface Word {
  bold: boolean;
  text: string;
}

function toWords(text: string): Word[] {
  // Poppins has no emoji, so they're left out rather than shown as boxes.
  const clean = text.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "").trim();
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ bold: /^\*\*.*\*\*[.,!?]?$/.test(w), text: w.replace(/\*\*/g, "") }));
}

function setWordFont(ctx: SKRSContext2D, bold: boolean, size: number) {
  ctx.font = bold ? `${size}px "Poppins ExtraBold"` : `${size}px "Poppins"`;
}

/** Splits words into lines no wider than maxWidth. */
function layoutWords(ctx: SKRSContext2D, words: Word[], maxWidth: number, size: number): Word[][] {
  const lines: Word[][] = [[]];
  let width = 0;
  for (const w of words) {
    setWordFont(ctx, w.bold, size);
    const ww = ctx.measureText(w.text).width;
    const space = ctx.measureText(" ").width;
    if (width && width + space + ww > maxWidth) {
      lines.push([]);
      width = 0;
    }
    width += (width ? space : 0) + ww;
    lines[lines.length - 1]!.push(w);
  }
  return lines;
}

/**
 * Draws the wish from (x, y), shrinking the text until it fits above maxBottom.
 * Returns the baseline of the last line.
 */
function richText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxBottom: number,
  colour: string,
  boldColour: string,
): number {
  const words = toWords(text);
  let size = 26;
  let lines = layoutWords(ctx, words, maxWidth, size);
  while (size > 14 && y + (lines.length - 1) * size * 1.4 > maxBottom) {
    size -= 1;
    lines = layoutWords(ctx, words, maxWidth, size);
  }
  let cy = y;
  for (const line of lines) {
    let cx = x;
    for (const w of line) {
      setWordFont(ctx, w.bold, size);
      ctx.fillStyle = w.bold ? boldColour : colour;
      ctx.fillText(w.text, cx, cy);
      cx += ctx.measureText(w.text).width + ctx.measureText(" ").width;
    }
    cy += Math.round(size * 1.4);
  }
  return cy - Math.round(size * 1.4);
}

function coverImage(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s,
    ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2.6, iw, ih);
}

export async function renderGoldStars({
  photo,
  name,
  dateLabel,
  groupName,
  wish,
  logo,
  credit,
  lang,
}: GoldStarsInput): Promise<Buffer> {
  const w = flyerWords(lang);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rand = rng(name);

  // Paper background with a soft warm glow.
  ctx.fillStyle = "#f7f2ea";
  ctx.fillRect(0, 0, W, H);
  grain(ctx, rand, 0, 0, W, H, 9000, "rgba(120,90,40,0.08)");

  // The gold card.
  const card = { x: 60, y: 150, w: 960, h: 1130 };
  const g = ctx.createLinearGradient(card.x, card.y, card.x + card.w, card.y + card.h);
  g.addColorStop(0, "#c98a2c");
  g.addColorStop(0.45, "#e8a33a");
  g.addColorStop(0.8, "#d27a1c");
  g.addColorStop(1, "#f0c46a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(card.x, card.y, card.w, card.h, 18);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(card.x, card.y, card.w, card.h, 18);
  ctx.clip();
  grain(ctx, rand, card.x, card.y, card.w, card.h, 14000, "rgba(255,240,200,0.18)");
  grain(ctx, rand, card.x, card.y, card.w, card.h, 9000, "rgba(90,40,0,0.12)");
  // Light bloom bottom-left where the name sits.
  const bloom = ctx.createRadialGradient(260, 1110, 0, 260, 1110, 480);
  bloom.addColorStop(0, "rgba(255,250,240,0.95)");
  bloom.addColorStop(1, "rgba(255,250,240,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(card.x, card.y, card.w, card.h);
  ctx.restore();

  // Photo: a big circle that runs off the card's left edge.
  const pc = { x: 395, y: 545, r: 330 };
  ctx.save();
  ctx.beginPath();
  ctx.arc(pc.x, pc.y, pc.r, 0, Math.PI * 2);
  ctx.clip();
  coverImage(ctx, await loadImage(photo), pc.x - pc.r, pc.y - pc.r, pc.r * 2, pc.r * 2);
  ctx.restore();
  // Glitter dusted along the bottom-right of the photo.
  ctx.save();
  ctx.beginPath();
  ctx.arc(pc.x, pc.y, pc.r + 40, -0.2, Math.PI * 0.9);
  ctx.arc(pc.x, pc.y, pc.r - 60, Math.PI * 0.9, -0.2, true);
  ctx.closePath();
  ctx.clip();
  glitter(ctx, rand, pc.x - pc.r - 40, pc.y - 60, pc.r * 2 + 20, pc.r + 120, 900, ["#fff8e1", "#ffe08a", "#ffffff"]);
  ctx.restore();

  // Date badge on the photo's lower-right edge: the day big, the month under it.
  {
    const br = 82;
    const bx = pc.x + Math.cos(0.72) * pc.r;
    const by = pc.y + Math.sin(0.72) * pc.r;
    const [day = "", ...rest] = dateLabel.trim().split(/\s+/);
    const month = rest.join(" ").slice(0, 3).toUpperCase();
    ctx.save();
    ctx.shadowColor = "rgba(70,35,0,0.4)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    const ring = ctx.createLinearGradient(bx - br, by - br, bx + br, by + br);
    ring.addColorStop(0, "#fff3c4");
    ring.addColorStop(0.5, "#d9a03a");
    ring.addColorStop(1, "#8a5a12");
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#fffaf0";
    ctx.beginPath();
    ctx.arc(bx, by, br - 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#2b2b2b";
    ctx.font = '64px "Poppins ExtraBold"';
    ctx.fillText(day, bx, by + 14);
    ctx.fillStyle = "#b8801f";
    ctx.font = '24px "Poppins SemiBold"';
    ctx.fillText(month, bx, by + 46);
    ctx.textAlign = "left";
  }

  // Wish on the right.
  const tx = 760,
    tw = 230;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = '34px "Poppins ExtraBold"';
  ctx.fillText(w.happy, tx, 330);
  const exclaim = w.lang === "fr" ? "anniversaire !" : "Birthday!";
  fitWidth(ctx, exclaim, tw);
  ctx.fillText(exclaim, tx, 370);
  // The group name goes under the wish and must end above the silver star
  // (around y = 720), so the wish gets whatever room the name leaves.
  ctx.font = '24px "Poppins ExtraBold"';
  const groupLines = wrapWords(ctx, groupName, tw);
  const end = richText(
    ctx,
    wish || (w.lang === "fr" ? SAMPLE_WISH_FR : SAMPLE_WISH),
    tx,
    420,
    tw,
    720 - 96 - 30 * (groupLines.length - 1),
    "#fff6e6",
    "#ffffff",
  );
  ctx.fillStyle = "#fff6e6";
  ctx.font = '22px "Poppins"';
  ctx.fillText(w.lang === "fr" ? "avec amour," : "with love,", tx, end + 64);
  ctx.font = '24px "Poppins ExtraBold"';
  ctx.fillStyle = "#ffffff";
  let gy = end + 96;
  for (const line of groupLines) {
    ctx.fillText(line, tx, gy);
    gy += 30;
  }
  // "+ + +" sparkle marks, top right.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = '30px "Poppins"';
  ["+  +", "+  +  +", "+  +  +"].forEach((s, i) => ctx.fillText(s, 870 + (i ? -22 : 0), 210 + i * 30));

  // Stars behind the headline.
  foilStar(ctx, 140, 900, 120, -0.25, "silver");
  foilStar(ctx, 975, 835, 105, 0.3, "silver");
  foilStar(ctx, 110, 120, 165, 0.15, "gold");

  // Headline and name, bottom left.
  ctx.fillStyle = "#2b2b2b";
  ctx.font = '150px "Poppins ExtraBold"';
  fitWidth(ctx, w.happy, W - 140);
  ctx.fillText(w.happy, 70, 1058);
  ctx.font = '64px "Poppins ExtraBold"';
  fitWidth(ctx, w.birthday.toUpperCase(), W - 160);
  ctx.fillText(w.birthday.toUpperCase(), 82, 1146);
  ctx.save();
  ctx.font = '112px "Great Vibes"';
  // Deep chocolate script with a soft light halo, so it reads on the pale bloom and the gold.
  ctx.fillStyle = "#4a2300";
  ctx.shadowColor = "rgba(255,248,230,0.9)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 0;
  let size = 112;
  while (ctx.measureText(name).width > 500 && size > 48) {
    size -= 4;
    ctx.font = `${size}px "Great Vibes"`;
  }
  ctx.fillText(name, 90, 1250);
  ctx.restore();

  // The big gold star in front, bottom right.
  foilStar(ctx, 815, 1045, 225, 0.05, "gold");
  glitter(ctx, rand, 600, 980, 480, 370, 160, ["#fff8e1", "#ffd36b"]);

  // The group's logo in the top right corner, above the card.
  if (logo) {
    const img = await loadImage(logo);
    const s = Math.min(120 / img.width, 120 / img.height);
    ctx.drawImage(img, W - 50 - img.width * s, 15, img.width * s, img.height * s);
  }

  drawCredit(ctx, credit, W, H, "right", W - 40);
  return canvas.encode("jpeg", 90);
}

function wrapWords(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
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
  if (lines.length <= 2) return lines;
  // Long group names keep two lines, the second shortened with "...".
  let second = lines.slice(1).join(" ");
  while (second.length > 1 && ctx.measureText(`${second}…`).width > maxWidth) second = second.slice(0, -1).trimEnd();
  return [lines[0]!, `${second}…`];
}

// Touches up member photos, like the "Auto" button in a photo editor, plus a
// few one-tap edits admins can pick from in the chat.
//
// When a photo comes in it's framed on the person's head and shoulders (so it
// sits right in round and arched photo frames without cropping by hand) and
// dark or dull photos are brightened and balanced. The photo as sent is kept,
// so "original" can always go back to it.

import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { personMask } from "./cutout.js";

/** Longest side of a saved photo; designs never draw one bigger. */
const MAX_SIDE = 1400;
/** Head width as a share of the framed photo's width: head and shoulders, not a passport photo. */
const HEAD_SHARE = 0.34;
/** Space above the head, as a share of the framed photo's height. */
const HEADROOM = 0.1;
/** Framed photos are 4:5 portrait where the photo allows. */
const ASPECT = 4 / 5;

export type PhotoEdit = "brighter" | "warmer" | "mono" | "plain" | "closer" | "rotate" | "original";

/** The edits as admins see them, in the order offered. `word` is what they type. */
export const PHOTO_EDITS: Array<{ edit: PhotoEdit; word: string; title: string; description: string }> = [
  { edit: "brighter", word: "brighter", title: "Brighter", description: "Lift a dark or shadowy face" },
  { edit: "warmer", word: "warmer", title: "Warmer", description: "Fix a cold, bluish or greenish look" },
  { edit: "plain", word: "plain background", title: "Plain background", description: "Swap a busy background for a clean studio look" },
  { edit: "closer", word: "closer", title: "Closer to the face", description: "Zoom in on the face" },
  { edit: "mono", word: "black and white", title: "Black and white", description: "Classic black and white" },
  { edit: "rotate", word: "rotate", title: "Rotate", description: "Turn a sideways photo the right way up" },
  { edit: "original", word: "original", title: "Original photo", description: "Undo all changes, as you sent it" },
];

/** "brighter", "b&w", "remove background"... -> the edit, or null. */
export function findPhotoEdit(word: string): PhotoEdit | null {
  const w = word.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(brighter|brighten|lighter|more light)$/.test(w)) return "brighter";
  if (/^warm(er)?$/.test(w)) return "warmer";
  if (/^(black (and|&) white|b ?& ?w|bw|mono|grayscale|greyscale)$/.test(w)) return "mono";
  if (/^(plain|white|clean|remove|no) (background|bg)$|^remove the background$/.test(w)) return "plain";
  if (/^(closer|zoom in|zoom|crop face|face)$/.test(w)) return "closer";
  if (/^(rotate|turn)$/.test(w)) return "rotate";
  if (/^(original|undo|reset photo)$/.test(w)) return "original";
  return null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the head is, from the person's outline (alpha values, one per pixel,
 * of a w x h picture). A head is roughly round, so reading down from the top
 * of the outline, the first row as wide as twice its depth is about halfway
 * down the head, and its width is the head's width. Shoulders further down
 * don't matter. Null when there's no single head, e.g. a row of people.
 */
export function findHead(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number): Box | null {
  let top = -1;
  for (let y = 0; y < h; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x]! > 128) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (x0 < 0 || x1 - x0 + 1 < w * 0.02) continue;
    if (top < 0) top = y;
    const width = x1 - x0 + 1;
    if (width <= 2 * (y - top + 1)) {
      if (width < w * 0.03 || width > w * 0.75) return null;
      return { x: (x0 + x1) / 2 - width / 2, y: top, w: width, h: Math.round(width * 1.3) };
    }
  }
  return null;
}

/**
 * A 4:5 crop of a w x h photo with the head centred, a little room above it,
 * and the shoulders in. When the photo is too short for that, it goes up to
 * square rather than cutting off the chin.
 */
export function frameAround(head: Box, w: number, h: number): Box {
  let cw = Math.min(Math.max(head.w / HEAD_SHARE, Math.min(w, 400)), w);
  const ch = Math.min(cw / ASPECT, h);
  cw = Math.min(cw, ch);
  const x = clamp(head.x + head.w / 2 - cw / 2, 0, w - cw);
  const y = clamp(head.y - ch * HEADROOM, 0, h - ch);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch) };
}

/**
 * What happens to every member photo when it's added: framed on the head and
 * shoulders, then brightened and balanced if it needs it. Photos with no
 * person found (a logo, a cartoon) are only toned.
 */
export async function preparePhoto(photo: Uint8Array): Promise<Buffer> {
  const img = await loadImage(Buffer.from(photo));
  let crop: Box = { x: 0, y: 0, w: img.width, h: img.height };
  const mask = await personMask(photo);
  if (mask) {
    // The outline at a small size, with the photo's real shape, is plenty to find the head.
    const s = 240 / Math.max(img.width, img.height);
    const mw = Math.max(1, Math.round(img.width * s));
    const mh = Math.max(1, Math.round(img.height * s));
    const small = createCanvas(mw, mh);
    const sctx = small.getContext("2d");
    sctx.drawImage(mask, 0, 0, mw, mh);
    const rgba = sctx.getImageData(0, 0, mw, mh).data;
    const alpha = new Uint8ClampedArray(mw * mh);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
    const head = findHead(alpha, mw, mh);
    if (head) {
      const f = frameAround(head, mw, mh);
      crop = { x: f.x / s, y: f.y / s, w: f.w / s, h: f.h / s };
    }
  }
  const out = drawCrop(img, crop);
  autoTone(out.getContext("2d"), out.width, out.height);
  return out.encode("jpeg", 92);
}

/** Brightens and balances a photo if it needs it, without reframing (event photos). */
export async function tonePhoto(photo: Uint8Array): Promise<Buffer> {
  const img = await loadImage(Buffer.from(photo));
  const out = drawCrop(img, { x: 0, y: 0, w: img.width, h: img.height });
  autoTone(out.getContext("2d"), out.width, out.height);
  return out.encode("jpeg", 92);
}

/**
 * One edit, applied to the current photo. "rotate" and "original" start
 * from the photo as it was sent (`original`): rotating turns it and frames
 * it again, since a sideways photo can't have been framed right.
 */
export async function editPhoto(edit: PhotoEdit, current: Uint8Array, original: Uint8Array): Promise<{ photo: Buffer; original?: Buffer }> {
  if (edit === "original") return { photo: Buffer.from(original) };
  if (edit === "rotate") {
    const img = await loadImage(Buffer.from(original));
    const turned = createCanvas(img.height, img.width);
    const ctx = turned.getContext("2d");
    ctx.translate(img.height, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    const rotated = await turned.encode("jpeg", 95);
    return { photo: await preparePhoto(rotated), original: rotated };
  }

  const img = await loadImage(Buffer.from(current));
  if (edit === "closer") {
    // Framed photos have the face a little above the middle; zoom in on that spot.
    const w = img.width * 0.8;
    const h = img.height * 0.8;
    const out = drawCrop(img, { x: (img.width - w) / 2, y: clamp(img.height * 0.38 - h * 0.4, 0, img.height - h), w, h });
    return { photo: await out.encode("jpeg", 92) };
  }

  if (edit === "plain") {
    const mask = await personMask(current);
    if (!mask) throw new NoPersonError();
    const out = createCanvas(img.width, img.height);
    const ctx = out.getContext("2d");
    // A soft studio backdrop: light in the middle, a touch darker at the edges.
    const r = Math.hypot(img.width, img.height) / 2;
    const bg = ctx.createRadialGradient(img.width / 2, img.height * 0.4, 0, img.width / 2, img.height * 0.4, r);
    bg.addColorStop(0, "#f4f3f1");
    bg.addColorStop(1, "#cfcdca");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, img.width, img.height);
    const person = createCanvas(img.width, img.height);
    const pctx = person.getContext("2d");
    pctx.drawImage(img, 0, 0);
    pctx.globalCompositeOperation = "destination-in";
    pctx.drawImage(mask, 0, 0, img.width, img.height);
    ctx.drawImage(person, 0, 0);
    return { photo: await out.encode("jpeg", 92) };
  }

  const out = drawCrop(img, { x: 0, y: 0, w: img.width, h: img.height });
  const ctx = out.getContext("2d");
  const data = ctx.getImageData(0, 0, out.width, out.height);
  const px = data.data;
  if (edit === "brighter") {
    // Lifts shadows and mid-tones and leaves highlights alone, so dark skin
    // shows its detail without white clothes or sky blowing out.
    const curve = lut((v) => 255 * Math.pow(v / 255, 0.78));
    for (let i = 0; i < px.length; i += 4) {
      px[i] = curve[px[i]!]!;
      px[i + 1] = curve[px[i + 1]!]!;
      px[i + 2] = curve[px[i + 2]!]!;
    }
  } else if (edit === "warmer") {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = Math.min(255, px[i]! * 1.06);
      px[i + 1] = Math.min(255, px[i + 1]! * 1.01);
      px[i + 2] = px[i + 2]! * 0.92;
    }
  } else if (edit === "mono") {
    // Leaning on the red channel, like a red filter on black and white film,
    // keeps skin luminous instead of muddy grey. A gentle S-curve adds punch.
    const curve = lut((v) => {
      const t = v / 255;
      return 255 * (t - 0.05 * Math.sin(2 * Math.PI * t));
    });
    for (let i = 0; i < px.length; i += 4) {
      const g = curve[Math.round(px[i]! * 0.45 + px[i + 1]! * 0.42 + px[i + 2]! * 0.13)]!;
      px[i] = g;
      px[i + 1] = g;
      px[i + 2] = g;
    }
  }
  ctx.putImageData(data, 0, 0);
  return { photo: await out.encode("jpeg", 92) };
}

/** Thrown when "plain background" finds no person to keep. */
export class NoPersonError extends Error {
  constructor() {
    super("no person found in the photo");
  }
}

/**
 * The automatic fix, in place. Only does what the photo needs:
 * - stretches a flat, hazy photo so its darkest parts are dark and lightest light,
 * - takes out a colour cast, judged only from the greys and whites in the picture
 *   (walls, shirts), never from skin, so brown skin isn't turned grey,
 * - lifts the mid-tones of a dark photo.
 */
export function autoTone(ctx: SKRSContext2D, w: number, h: number) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const hist = new Uint32Array(256);
  let nr = 0;
  let ng = 0;
  let nb = 0;
  let neutral = 0;
  const step = Math.max(1, Math.floor((w * h) / 200_000)) * 4;
  let count = 0;
  for (let i = 0; i < px.length; i += step) {
    const r = px[i]!;
    const g = px[i + 1]!;
    const b = px[i + 2]!;
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[lum]!++;
    count++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (lum > 60 && lum < 240 && max - min < max * 0.18) {
      nr += r;
      ng += g;
      nb += b;
      neutral++;
    }
  }
  const percentile = (p: number) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v]!;
      if (seen >= count * p) return v;
    }
    return 255;
  };
  // Never stretch more than this, so a photo that's meant to be soft isn't made harsh.
  const black = Math.min(percentile(0.005), 40);
  const white = Math.max(percentile(0.995), 200);
  const median = (percentile(0.5) - black) / (white - black);
  // Lift only dark photos, and only part of the way, so dark skin stays dark skin.
  const gamma = median > 0 && median < 0.42 ? clamp(Math.log(0.42) / Math.log(median), 0.65, 1) : 1;

  let gains = [1, 1, 1];
  if (neutral > count * 0.03) {
    const avg = (nr + ng + nb) / 3;
    gains = [avg / nr, avg / ng, avg / nb].map((g) => clamp(1 + (g - 1) * 0.7, 0.9, 1.1));
  }
  const curves = gains.map((gain) =>
    lut((v) => {
      const t = clamp((v * gain - black) / (white - black), 0, 1);
      return 255 * Math.pow(t, gamma);
    }),
  );
  for (let i = 0; i < px.length; i += 4) {
    px[i] = curves[0]![px[i]!]!;
    px[i + 1] = curves[1]![px[i + 1]!]!;
    px[i + 2] = curves[2]![px[i + 2]!]!;
  }
  ctx.putImageData(data, 0, 0);
}

function drawCrop(img: Image, box: Box): Canvas {
  const s = Math.min(1, MAX_SIDE / Math.max(box.w, box.h));
  const out = createCanvas(Math.round(box.w * s), Math.round(box.h * s));
  out.getContext("2d").drawImage(img, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  return out;
}

function lut(f: (v: number) => number): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) table[v] = Math.round(f(v));
  return table;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

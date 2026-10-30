import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";

// Pictures for the shop page, sized for phones. Owners upload full-size photos
// (often 3 to 5 MB from a phone camera); the page asks for the width it shows
// them at, so a customer on 3G downloads tens of kilobytes, not megabytes.

/** The widths the page asks for: a grid card, a full-screen phone, a big screen. */
export const WIDTHS = [360, 720, 1080] as const;
export type Width = (typeof WIDTHS)[number];

export function pickWidth(asked: string | undefined): Width {
  const n = Number(asked);
  return WIDTHS.find((w) => w >= n) ?? 720;
}

const MAX_ENTRIES = 300;
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: Buffer }>();

/** Made once per key, then kept for ten minutes so a changed photo shows up soon after. */
async function cached(key: string, make: () => Promise<Buffer | null>): Promise<Buffer | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    // Re-inserting keeps the most used pictures at the end, away from the trim below.
    cache.delete(key);
    cache.set(key, hit);
    return hit.data;
  }
  const data = await make();
  if (!data) return null;
  cache.set(key, { at: Date.now(), data });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return data;
}

/** A photo at most `width` wide, as WebP. Never made bigger than the original. */
export function resized(key: string, width: Width, load: () => Promise<Uint8Array | null>): Promise<Buffer | null> {
  return cached(`${key}@${width}`, async () => {
    const data = await load();
    if (!data) return null;
    const image = await loadImage(Buffer.from(data));
    const w = Math.min(width, image.width);
    const h = Math.round((image.height * w) / image.width);
    const canvas = createCanvas(w, h);
    canvas.getContext("2d").drawImage(image, 0, 0, w, h);
    return canvas.encode("webp", 72);
  });
}

const fontDir = fileURLToPath(new URL("../../../assets/fonts/", import.meta.url));
let fontsLoaded = false;

/**
 * The 1200 x 630 picture WhatsApp, Instagram and Facebook show when the shop
 * link is shared: the cover (or first product photo) with the logo on it, or,
 * with no photos, the logo and name on the shop's colour.
 */
export function previewCard(key: string, input: { photo: Uint8Array | null; logo: Uint8Array | null; name: string; accent: string; ink: string }): Promise<Buffer | null> {
  return cached(`preview:${key}`, async () => {
    if (!fontsLoaded) {
      GlobalFonts.registerFromPath(`${fontDir}Inter-ExtraBold.otf`, "Inter ExtraBold");
      fontsLoaded = true;
    }
    const W = 1200;
    const H = 630;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    const photo = input.photo && (await loadImage(Buffer.from(input.photo)).catch(() => null));
    const logo = input.logo && (await loadImage(Buffer.from(input.logo)).catch(() => null));
    if (photo) {
      cover(ctx, photo, W, H);
      if (logo) badge(ctx, logo, 48, H - 48 - 120, 120);
    } else {
      ctx.fillStyle = input.accent;
      ctx.fillRect(0, 0, W, H);
      const size = logo ? 200 : 0;
      if (logo) badge(ctx, logo, (W - size) / 2, 120, size);
      ctx.fillStyle = input.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let px = 72;
      ctx.font = `${px}px "Inter ExtraBold"`;
      while (px > 36 && ctx.measureText(input.name).width > W - 120) ctx.font = `${(px -= 4)}px "Inter ExtraBold"`;
      ctx.fillText(input.name, W / 2, logo ? 440 : H / 2);
    }
    return canvas.encode("jpeg", 82);
  });
}

function cover(ctx: SKRSContext2D, image: Image, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, w, h);
}

/** The logo on a white rounded square, so any logo reads on any background. */
function badge(ctx: SKRSContext2D, logo: Image, x: number, y: number, size: number) {
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, size * 0.18);
  ctx.fill();
  const pad = size * 0.1;
  const scale = Math.min((size - 2 * pad) / logo.width, (size - 2 * pad) / logo.height);
  const lw = logo.width * scale;
  const lh = logo.height * scale;
  ctx.drawImage(logo, x + (size - lw) / 2, y + (size - lh) / 2, lw, lh);
}

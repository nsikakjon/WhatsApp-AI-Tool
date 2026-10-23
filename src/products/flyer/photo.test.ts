import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { autoTone, editPhoto, findHead, findPhotoEdit, frameAround } from "./photo.js";

/** A head-and-shoulders outline: a 40-wide head from y=20 to 70, then 120-wide shoulders. */
function silhouette(w = 200, h = 250, cx = 120) {
  const alpha = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const half = y < 20 ? 0 : y < 70 ? 20 : y < 80 ? 12 : 60;
    for (let x = cx - half; x < cx + half; x++) if (half && x >= 0 && x < w) alpha[y * w + x] = 255;
  }
  return { alpha, w, h };
}

async function solid(w: number, h: number, colour: string) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, w, h);
  return c.encode("png");
}

describe("photo touch-ups", () => {
  it("finds the head above the shoulders", () => {
    const { alpha, w, h } = silhouette();
    const head = findHead(alpha, w, h)!;
    expect(head.y).toBe(20);
    expect(head.w).toBe(40);
    expect(Math.abs(head.x + head.w / 2 - 120)).toBeLessThanOrEqual(1);
    expect(head.h).toBeLessThanOrEqual(60);
  });

  it("finds nothing in an empty outline", () => {
    expect(findHead(new Uint8ClampedArray(100 * 100), 100, 100)).toBeNull();
  });

  it("frames a 4:5 crop centred on the head, inside the photo", () => {
    const box = frameAround({ x: 1000, y: 400, w: 400, h: 500 }, 3000, 4000);
    expect(box.w / box.h).toBeCloseTo(0.8, 2);
    expect(box.x + box.w / 2).toBeCloseTo(1200, -1);
    expect(box.y).toBeLessThan(400);
    // Near the edge, it shifts rather than going off the photo.
    const edge = frameAround({ x: 0, y: 0, w: 400, h: 500 }, 3000, 4000);
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
  });

  it("goes up to square rather than cutting the chin off a short photo", () => {
    const box = frameAround({ x: 500, y: 100, w: 400, h: 500 }, 1600, 900);
    expect(box.h).toBe(900);
    expect(box.w).toBe(900);
  });

  it("understands the edit words", () => {
    expect(findPhotoEdit("Brighter")).toBe("brighter");
    expect(findPhotoEdit("black and white")).toBe("mono");
    expect(findPhotoEdit("b&w")).toBe("mono");
    expect(findPhotoEdit("remove background")).toBe("plain");
    expect(findPhotoEdit("zoom in")).toBe("closer");
    expect(findPhotoEdit("undo")).toBe("original");
    expect(findPhotoEdit("remove")).toBeNull();
    expect(findPhotoEdit("background")).toBeNull();
  });

  it("lifts a dark, flat photo and leaves a good one alone", async () => {
    const dark = createCanvas(100, 100);
    const ctx = dark.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 100, 0);
    g.addColorStop(0, "#202020");
    g.addColorStop(1, "#707070");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 100, 100);
    const before = ctx.getImageData(50, 50, 1, 1).data[0]!;
    autoTone(ctx, 100, 100);
    expect(ctx.getImageData(50, 50, 1, 1).data[0]!).toBeGreaterThan(before + 20);

    const good = createCanvas(100, 100);
    const gctx = good.getContext("2d");
    const full = gctx.createLinearGradient(0, 0, 100, 0);
    full.addColorStop(0, "#000000");
    full.addColorStop(1, "#ffffff");
    gctx.fillStyle = full;
    gctx.fillRect(0, 0, 100, 100);
    const mid = gctx.getImageData(50, 50, 1, 1).data[0]!;
    autoTone(gctx, 100, 100);
    expect(Math.abs(gctx.getImageData(50, 50, 1, 1).data[0]! - mid)).toBeLessThan(4);
  });

  it("takes a blue cast out of the greys", async () => {
    const c = createCanvas(50, 50);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#8c96a8";
    ctx.fillRect(0, 0, 50, 50);
    autoTone(ctx, 50, 50);
    const [r, , b] = ctx.getImageData(10, 10, 1, 1).data;
    expect(b! - r!).toBeLessThan(0xa8 - 0x8c);
  });

  it("turns a photo black and white, warmer or closer, and back to the original", async () => {
    const photo = await solid(80, 100, "#c06030");
    const mono = await loadImage((await editPhoto("mono", photo, photo)).photo);
    const px = (img: typeof mono) => {
      const c = createCanvas(img.width, img.height);
      c.getContext("2d").drawImage(img, 0, 0);
      return c.getContext("2d").getImageData(5, 5, 1, 1).data;
    };
    const [r, g, b] = px(mono);
    expect(Math.abs(r! - g!)).toBeLessThan(3);
    expect(Math.abs(g! - b!)).toBeLessThan(3);

    const warm = px(await loadImage((await editPhoto("warmer", photo, photo)).photo));
    expect(warm[2]!).toBeLessThan(0x30);

    const closer = await loadImage((await editPhoto("closer", photo, photo)).photo);
    expect(closer.width).toBe(64);

    const original = await editPhoto("original", photo, photo);
    expect(Buffer.compare(original.photo, Buffer.from(photo))).toBe(0);
  });
});

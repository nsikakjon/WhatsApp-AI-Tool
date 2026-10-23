// Cuts a person out of their photo, so designs can stand them in front of
// shapes and big numbers instead of inside a circle.
//
// It uses ISNet, a free open-source model (Apache 2.0 licence) that runs on
// our own server through ONNX Runtime: no outside service and no fee per
// photo. Each photo is cut out once, when it's added, and the result is saved
// (see store.ts); flyers reuse the saved cutout.

import { createRequire } from "node:module";
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import type { InferenceSession } from "onnxruntime-node";

const SIZE = 1024; // the model looks at a 1024 x 1024 copy of the photo
/** Longest side of the saved cutout; flyers never draw a person bigger than this. */
const MAX_SIDE = 1400;

let session: Promise<InferenceSession> | undefined;
let idleTimer: NodeJS.Timeout | undefined;
let queue: Promise<unknown> = Promise.resolve();

/**
 * Loads the model the first time it's needed. It takes about 600 MB of memory
 * while loaded, so it's let go again after two quiet minutes.
 */
function model(): Promise<InferenceSession> {
  session ??= (async () => {
    const ort = await import("onnxruntime-node");
    const path = createRequire(import.meta.url).resolve("isnet-background-removal/models/isnet-general-use.onnx");
    return ort.InferenceSession.create(path, { enableCpuMemArena: false, enableMemPattern: false });
  })();
  return session;
}

function releaseLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const old = session;
    session = undefined;
    void old?.then((s) => s.release()).catch(() => {});
  }, 120_000);
  idleTimer.unref();
}

/** One photo at a time, so a big import can't use several times the memory. */
function queued<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => {});
  return run.finally(releaseLater);
}

/**
 * Returns the person on a see-through background as a PNG, trimmed to the
 * person with a little margin. Returns null when no one is found (for example
 * a logo or a picture of a cake), so the plain photo is used instead.
 */
export function cutOut(photo: Uint8Array): Promise<Buffer | null> {
  return queued(async () => {
    const img = await loadImage(Buffer.from(photo));
    const mask = await maskOf(img);
    return mask && trimmedCutout(img, mask);
  });
}

/**
 * The person's outline: a 1024 x 1024 picture, see-through except where the
 * person is, to be stretched back over the photo. Null when no one is found.
 */
export function personMask(photo: Uint8Array): Promise<Canvas | null> {
  return queued(async () => maskOf(await loadImage(Buffer.from(photo))));
}

async function maskOf(img: Image): Promise<Canvas | null> {
  const ort = await import("onnxruntime-node");
  // The model's input: the photo squashed to 1024 x 1024, colours as -0.5 to 0.5.
  const small = createCanvas(SIZE, SIZE);
  const sctx = small.getContext("2d");
  sctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = sctx.getImageData(0, 0, SIZE, SIZE).data;
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    input[i] = px[i * 4]! / 255 - 0.5;
    input[i + SIZE * SIZE] = px[i * 4 + 1]! / 255 - 0.5;
    input[i + 2 * SIZE * SIZE] = px[i * 4 + 2]! / 255 - 0.5;
  }
  const session = await model();
  const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  const raw = out[session.outputNames[0]!]!.data as Float32Array;

  // The model's answer: how sure it is that each pixel is the person.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < SIZE * SIZE; i++) {
    lo = Math.min(lo, raw[i]!);
    hi = Math.max(hi, raw[i]!);
  }
  if (hi - lo < 1e-6) return null;
  const mask = createCanvas(SIZE, SIZE);
  const mctx = mask.getContext("2d");
  const m = mctx.createImageData(SIZE, SIZE);
  let person = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    // Clean up the faint haze the model leaves around the edges.
    const v = (raw[i]! - lo) / (hi - lo);
    const a = Math.round(Math.min(1, Math.max(0, (v - 0.08) / 0.84)) * 255);
    if (a > 128) person++;
    m.data[i * 4 + 3] = a;
  }
  // Under 3% of the picture: no person to speak of.
  if (person < SIZE * SIZE * 0.03) return null;
  mctx.putImageData(m, 0, 0);
  return mask;
}

function trimmedCutout(img: Image, mask: Canvas): Promise<Buffer> {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  // The photo at full size, keeping only the person.
  const full = createCanvas(w, h);
  const ctx = full.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0, w, h);

  // Trim to the person, with a small margin.
  const alpha = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3]! > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const pad = Math.round(Math.max(w, h) * 0.02);
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const trimmed = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
  trimmed.getContext("2d").drawImage(full, -x0, -y0);
  return trimmed.encode("png");
}

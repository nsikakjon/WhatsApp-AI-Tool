// Finds faces in a photo, so member photos can be framed on the face.
//
// It uses YuNet, OpenCV's small open-source face detector (MIT licence, a
// 230 KB file in assets/models), run on our own server through ONNX Runtime.
// It takes a few hundredths of a second and very little memory, unlike the
// cut-out model.

import { fileURLToPath } from "node:url";
import { createCanvas, type Image } from "@napi-rs/canvas";
import type { InferenceSession } from "onnxruntime-node";
import type { Box } from "./photo.js";

const SIZE = 640; // the model looks at a 640 x 640 copy, the photo fitted inside
const MIN_SCORE = 0.6;
const modelPath = fileURLToPath(new URL("../../../assets/models/face_detection_yunet_2023mar.onnx", import.meta.url));

let session: Promise<InferenceSession> | undefined;

function model(): Promise<InferenceSession> {
  session ??= import("onnxruntime-node").then((ort) => ort.InferenceSession.create(modelPath));
  return session;
}

/** The faces in a photo, in photo pixels, biggest first. Each box runs from the brows to the chin. */
export async function findFaces(img: Image): Promise<Box[]> {
  const ort = await import("onnxruntime-node");
  const scale = SIZE / Math.max(img.width, img.height);
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  // Blue, green, red planes, 0 to 255, as OpenCV models expect.
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    input[i] = px[i * 4 + 2]!;
    input[i + SIZE * SIZE] = px[i * 4 + 1]!;
    input[i + 2 * SIZE * SIZE] = px[i * 4]!;
  }
  const s = await model();
  const out = await s.run({ input: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });

  const faces: Array<Box & { score: number }> = [];
  for (const stride of [8, 16, 32]) {
    const cls = out[`cls_${stride}`]!.data as Float32Array;
    const obj = out[`obj_${stride}`]!.data as Float32Array;
    const bbox = out[`bbox_${stride}`]!.data as Float32Array;
    const cols = SIZE / stride;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(clamp01(cls[i]!) * clamp01(obj[i]!));
      if (score < MIN_SCORE) continue;
      const cx = ((i % cols) + bbox[i * 4]!) * stride;
      const cy = (Math.floor(i / cols) + bbox[i * 4 + 1]!) * stride;
      const w = Math.exp(bbox[i * 4 + 2]!) * stride;
      const h = Math.exp(bbox[i * 4 + 3]!) * stride;
      faces.push({ x: (cx - w / 2) / scale, y: (cy - h / 2) / scale, w: w / scale, h: h / scale, score });
    }
  }
  // The model marks each face several times; keep the most confident of each overlapping set.
  faces.sort((a, b) => b.score - a.score);
  const kept: Box[] = [];
  for (const f of faces) if (!kept.some((k) => overlap(k, f) > 0.3)) kept.push({ x: f.x, y: f.y, w: f.w, h: f.h });
  return kept.sort((a, b) => b.w * b.h - a.w * a.h);
}

function overlap(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (w * h) / (a.w * a.h + b.w * b.h - w * h);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

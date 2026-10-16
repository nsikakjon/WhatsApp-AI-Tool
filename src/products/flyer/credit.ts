// The "Made with yarnOga" watermark, drawn the same way on every flyer design:
// a small dark tag with the yarnOga mark, the credit text in Schibsted Grotesk,
// and the word "yarnOga" in brand lime. It sits on a dark backing so it stays
// readable on light and dark designs alike.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GlobalFonts, Image, type SKRSContext2D } from "@napi-rs/canvas";

const assetDir = fileURLToPath(new URL("../../../assets/", import.meta.url));
const FONT = "Schibsted Grotesk SemiBold";
const LIME = "#c6ff1f";
const CREAM = "#f3f1e6";
const BACKING = "rgba(10,13,11,0.78)";
const BRAND = "yarnOga";

let mark: Image | undefined;
function load(): Image {
  if (!mark) {
    GlobalFonts.registerFromPath(`${assetDir}fonts/SchibstedGrotesk-SemiBold.ttf`, FONT);
    mark = new Image();
    mark.src = readFileSync(`${assetDir}brand/yarnoga-mark-128.png`);
  }
  return mark;
}

/**
 * Draws the credit tag at the bottom of a flyer. `align` and `x` say where it
 * sits: "center" centres it on x, "left" starts it at x, "right" ends it at x.
 */
export function drawCredit(
  ctx: SKRSContext2D,
  credit: string | undefined,
  width: number,
  height: number,
  align: CanvasTextAlign = "center",
  x = width / 2,
): void {
  if (!credit) return;
  const icon = load();
  ctx.save();
  let size = 18;
  const iconSize = 22;
  const padX = 10;
  const gap = 7;
  const tagH = 32;
  ctx.font = `${size}px "${FONT}"`;
  // Shrink long credits so the tag never runs off the flyer.
  const maxText = width - 80 - iconSize - gap - padX * 2;
  while (ctx.measureText(credit).width > maxText && size > 12) {
    size -= 1;
    ctx.font = `${size}px "${FONT}"`;
  }
  const textW = ctx.measureText(credit).width;
  const tagW = padX * 2 + iconSize + gap + textW;
  const left = align === "center" ? x - tagW / 2 : align === "right" || align === "end" ? x - tagW : x;
  const top = height - tagH - 6;

  ctx.fillStyle = BACKING;
  ctx.beginPath();
  ctx.roundRect(left, top, tagW, tagH, 6);
  ctx.fill();
  ctx.drawImage(icon, left + padX, top + (tagH - iconSize) / 2, iconSize, iconSize);

  // Credit text, with "yarnOga" picked out in lime.
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cx = left + padX + iconSize + gap;
  const cy = top + tagH / 2 + 1;
  for (const part of credit.split(new RegExp(`(${BRAND})`))) {
    if (!part) continue;
    ctx.fillStyle = part === BRAND ? LIME : CREAM;
    ctx.fillText(part, cx, cy);
    cx += ctx.measureText(part).width;
  }
  ctx.restore();
}

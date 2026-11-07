// Ten more birthday designs (19 to 28), one for each graphic design style
// jay picked from his reference video: magazine cover, Swiss grid, minimal,
// retro, pop art, Y2K chrome, frosted glass, paper collage, marker scribble
// and aurora. The cut-out designs stand the person in front of the design
// (see cutout.ts) and fall back to the plain photo when there is no cut-out.
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import {
  circleText,
  cover,
  creditLine,
  fitFont,
  fitWish,
  H,
  metal,
  personLayer,
  rng,
  sparkle,
  spaced,
  W,
  withShadow,
  wrap,
} from "./designs4.js";
import { dateOf, drawLogo, roundRect, type Design7Input } from "./designs7.js";
import { fitWidth, flyerWords } from "./words.js";

type Ctx = SKRSContext2D;

const CHROME = ["#ffffff", "#dfe6ff", "#8e9bd6", "#262a5c", "#b9c6ff", "#ffffff"];

/** The photo drawn through a canvas filter, e.g. "grayscale(1)". */
function filtered(img: Image, w: number, h: number, filter: string, fx = 0.5, fy = 0.3): Canvas {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.filter = filter;
  cover(ctx, img, 0, 0, w, h, fx, fy);
  return c;
}

/** The cut-out in one flat colour, for outlines and hard shadows. */
function silhouette(layer: Canvas, colour: string): Canvas {
  const c = createCanvas(layer.width, layer.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(layer, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** A star-shaped comic burst. */
function burst(ctx: Ctx, cx: number, cy: number, outer: number, inner: number, points: number, rand: () => number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? inner : outer * (0.88 + rand() * 0.12);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** A rectangle with ragged, hand-torn edges. */
function torn(ctx: Ctx, x: number, y: number, w: number, h: number, jag: number, rand: () => number) {
  const step = 14;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let t = step; t < w; t += step) ctx.lineTo(x + t, y + (rand() - 0.5) * jag);
  for (let t = 0; t < h; t += step) ctx.lineTo(x + w + (rand() - 0.5) * jag, y + t);
  for (let t = w; t > 0; t -= step) ctx.lineTo(x + t, y + h + (rand() - 0.5) * jag);
  for (let t = h; t > 0; t -= step) ctx.lineTo(x + (rand() - 0.5) * jag, y + t);
  ctx.closePath();
}

function tape(ctx: Ctx, cx: number, cy: number, w: number, h: number, angle: number, colour: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = colour;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Text with a thick outline and a hard offset shadow, comic-sticker style. */
function hardText(ctx: Ctx, text: string, x: number, y: number, fill: string, outline: string, line: number, shadow: number) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = line;
  ctx.strokeStyle = outline;
  ctx.fillStyle = outline;
  ctx.strokeText(text, x + shadow, y + shadow);
  ctx.fillText(text, x + shadow, y + shadow);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------- 19. Magazine cover: masthead behind the person, cover lines beside ----------

export async function renderEditorial(input: Design7Input): Promise<Buffer> {
  const { photo, cutout, name, dateLabel, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d");
  const studio = ctx.createRadialGradient(W * 0.6, 520, 80, W * 0.6, 620, 1000);
  studio.addColorStop(0, "#e9e3d8");
  studio.addColorStop(1, "#a59a88");
  ctx.fillStyle = studio;
  ctx.fillRect(0, 0, W, H);
  if (!cutout && photo) cover(ctx, await loadImage(photo), 0, 0, W, H, 0.5, 0.25);

  ctx.fillStyle = "#c8102e";
  ctx.textAlign = "center";
  ctx.font = "250px Playfair Display Black";
  const mast = w.birthday.toUpperCase();
  fitWidth(ctx, mast, W - 80);
  ctx.fillText(mast, W / 2, 300);

  if (cutout) withShadow(ctx, personLayer(await loadImage(cutout), 820, 1050, 0.92), 300, H - 1050, "rgba(0,0,0,0.35)", 40);

  // Darken the left and the foot so the cover lines read on any photo.
  const shade = createCanvas(600, H),
    sctx = shade.getContext("2d");
  const left = sctx.createLinearGradient(0, 0, 600, 0);
  left.addColorStop(0, "rgba(0,0,0,0.6)");
  left.addColorStop(1, "rgba(0,0,0,0)");
  sctx.fillStyle = left;
  sctx.fillRect(0, 0, 600, H);
  sctx.globalCompositeOperation = "destination-in";
  const down = sctx.createLinearGradient(0, 420, 0, 640);
  down.addColorStop(0, "rgba(0,0,0,0)");
  down.addColorStop(1, "#000");
  sctx.fillStyle = down;
  sctx.fillRect(0, 0, 600, H);
  ctx.drawImage(shade, 0, 0);
  const foot = ctx.createLinearGradient(0, H - 380, 0, H);
  foot.addColorStop(0, "rgba(0,0,0,0)");
  foot.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = foot;
  ctx.fillRect(0, H - 380, W, 380);

  // Issue line above the masthead.
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "24px Poppins SemiBold";
  fitWidth(ctx, groupName.toUpperCase(), 560, 3);
  spaced(ctx, groupName.toUpperCase(), 48, 58, 3, "left");
  ctx.font = "24px Poppins SemiBold";
  spaced(ctx, dateLabel.toUpperCase(), W - 48, 58, 3, "right");
  ctx.fillRect(48, 76, W - 96, 3);

  // Cover lines.
  ctx.textAlign = "left";
  ctx.font = "26px Poppins SemiBold";
  const tag = w.lang === "fr" ? "À LA UNE" : "COVER STORY";
  const tagW = ctx.measureText(tag).width + 28;
  ctx.fillStyle = "#c8102e";
  ctx.fillRect(48, 620, tagW, 44);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(tag, 62, 652);
  ctx.font = "96px Anton";
  const nameLines = wrap(ctx, name.toUpperCase(), 440);
  if (nameLines.length > 2) {
    fitFont(ctx, name.toUpperCase(), "Anton", 96, 40, 440 * 2);
    nameLines.splice(0, nameLines.length, ...wrap(ctx, name.toUpperCase(), 440));
  }
  const nameSize = Number(ctx.font.match(/(\d+)px/)![1]);
  let y = 690 + nameSize;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 12;
  for (const line of nameLines.slice(0, 2)) {
    ctx.fillText(line, 48, y);
    y += nameSize * 1.02;
  }
  const { lines, size } = fitWish(ctx, wish, "Poppins", 28, 21, 410, 5);
  ctx.font = `${size}px Poppins`;
  y += 10;
  for (const line of lines) {
    ctx.fillText(line, 48, y);
    y += size * 1.4;
  }
  ctx.shadowColor = "transparent";

  ctx.font = "92px Anton";
  const hb = w.happyBirthday.toUpperCase();
  fitWidth(ctx, hb, 640);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(hb, 48, H - 80);

  // Barcode and logo, bottom right.
  const rand = rng(name + "barcode");
  let bx = W - 200;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(bx - 12, H - 190, 176, 120);
  ctx.fillStyle = "#111111";
  while (bx < W - 64) {
    const bw = 2 + Math.floor(rand() * 5);
    ctx.fillRect(bx, H - 178, bw, 80);
    bx += bw + 2 + Math.floor(rand() * 4);
  }
  await drawLogo(ctx, logo, W - 48, H - 300, 96, "right");
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 20. Swiss grid: huge red day number, black-and-white photo column ----------

export async function renderSwiss(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const { day, month } = dateOf(dateLabel);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#f1eee7";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(0,0,0,0.09)";
  ctx.lineWidth = 1.5;
  for (let x = 48; x <= W - 48; x += (W - 96) / 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 120; y < H; y += 165) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const col = (W - 96) / 6;
  const px = 48 + col * 3,
    pw = col * 3,
    py = 285,
    ph = 825;
  if (photo) ctx.drawImage(filtered(await loadImage(photo), pw, ph, "grayscale(1) contrast(1.15)", 0.5, 0.25), px, py);

  // Top band.
  ctx.fillStyle = "#111111";
  ctx.fillRect(48, 100, W - 96, 4);
  ctx.textAlign = "left";
  ctx.font = "26px Inter ExtraBold";
  fitWidth(ctx, groupName.toUpperCase(), W - 96 - 160, 2);
  spaced(ctx, groupName.toUpperCase(), 48, 76, 2, "left");
  await drawLogo(ctx, logo, W - 48, 20, 70, "right");

  // The day, huge, over the edge of the photo.
  ctx.fillStyle = "#e3001b";
  ctx.font = "560px Anton";
  ctx.fillText(String(day), 34, 690);
  const dayW = ctx.measureText(String(day)).width;
  ctx.font = "48px Inter ExtraBold";
  ctx.fillText(w.ordinal(day).replace(String(day), ""), 34 + dayW + 8, 220);

  ctx.fillStyle = "#111111";
  ctx.font = "50px Inter ExtraBold";
  ctx.fillText(w.months[month]!.toUpperCase(), 48, 770);
  ctx.font = "104px Inter ExtraBold";
  const happy = w.happy.toUpperCase(),
    birthday = w.birthday.toUpperCase();
  fitWidth(ctx, birthday, col * 3 - 20);
  ctx.fillText(happy, 44, 900);
  ctx.fillText(birthday, 44, 1000);

  const { lines, size } = fitWish(ctx, wish, "Inter", 24, 18, col * 3 - 40, 4);
  ctx.font = `${size}px Inter`;
  ctx.fillStyle = "#333333";
  lines.forEach((l, i) => ctx.fillText(l, 48, 1060 + i * size * 1.45));

  ctx.fillStyle = "#111111";
  ctx.font = "50px Inter ExtraBold";
  fitWidth(ctx, name, pw);
  ctx.fillText(name, px, 1180);
  ctx.fillStyle = "#e3001b";
  ctx.fillRect(px, 1208, 90, 10);
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 21. Minimal: cream page, one small photo, quiet type ----------

export async function renderMinimal(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#f6f1e8";
  ctx.fillRect(0, 0, W, H);
  await drawLogo(ctx, logo, W / 2, 50, 70, "center");
  if (photo) cover(ctx, await loadImage(photo), W / 2 - 250, 160, 500, 625, 0.5, 0.25);

  ctx.textAlign = "center";
  ctx.fillStyle = "#1d1d1b";
  ctx.font = "74px Playfair Display Bold";
  fitWidth(ctx, w.happyBirthday, W - 160);
  ctx.fillText(w.happyBirthday, W / 2, 900);
  ctx.font = "44px Poppins";
  fitWidth(ctx, name, W - 160);
  ctx.fillText(name, W / 2, 975);
  ctx.fillStyle = "#b08d57";
  ctx.fillRect(W / 2 - 40, 1015, 80, 3);

  ctx.fillStyle = "#6f6a60";
  ctx.font = "24px Poppins SemiBold";
  spaced(ctx, dateLabel.toUpperCase(), W / 2, 1075, 5, "center");
  ctx.font = "22px Poppins";
  fitWidth(ctx, groupName.toUpperCase(), W - 200, 4);
  spaced(ctx, groupName.toUpperCase(), W / 2, 1115, 4, "center");

  const { lines, size } = fitWish(ctx, wish, "Poppins", 25, 19, W - 300, 3);
  ctx.font = `${size}px Poppins`;
  ctx.fillStyle = "#4a463f";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 1180 + i * size * 1.5));
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 22. Retro: sunburst, arched photo, seventies stripes ----------

export async function renderRetro(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#f4e4c1";
  ctx.fillRect(0, 0, W, H);
  const rays = 28;
  ctx.fillStyle = "#f3b562";
  for (let i = 0; i < rays; i += 2) {
    const a0 = (i / rays) * Math.PI * 2,
      a1 = ((i + 1) / rays) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, 560);
    ctx.lineTo(W / 2 + Math.cos(a0) * 1600, 560 + Math.sin(a0) * 1600);
    ctx.lineTo(W / 2 + Math.cos(a1) * 1600, 560 + Math.sin(a1) * 1600);
    ctx.fill();
  }

  // Stripes behind the title.
  ["#c8471b", "#e8891c", "#f2b632", "#2f7f6d"].forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, 930 + i * 38, W, 38);
  });

  // Arched photo with a cream frame.
  const ax = W / 2 - 270,
    ay = 170,
    aw = 540,
    ah = 700;
  const arch = (inset: number) => {
    ctx.beginPath();
    ctx.moveTo(ax + inset, ay + ah - inset);
    ctx.lineTo(ax + inset, ay + aw / 2);
    ctx.arc(W / 2, ay + aw / 2, aw / 2 - inset, Math.PI, 0);
    ctx.lineTo(ax + aw - inset, ay + ah - inset);
    ctx.closePath();
  };
  ctx.save();
  ctx.shadowColor = "rgba(90,40,0,0.35)";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#7a2e0e";
  arch(-22);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fff6e0";
  arch(-12);
  ctx.fill();
  if (photo) {
    ctx.save();
    arch(6);
    ctx.clip();
    ctx.drawImage(filtered(await loadImage(photo), aw, ah, "sepia(0.25) saturate(1.15) contrast(1.05)", 0.5, 0.25), ax, ay);
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.font = "112px Poppins ExtraBold";
  const hb = w.happyBirthday.toUpperCase();
  fitWidth(ctx, hb, W - 90);
  ctx.lineJoin = "round";
  for (let i = 7; i > 0; i--) {
    ctx.fillStyle = i > 3 ? "#7a2e0e" : "#c8471b";
    ctx.fillText(hb, W / 2 + i * 1.5, 1060 + i * 1.5);
  }
  ctx.fillStyle = "#fff6e0";
  ctx.fillText(hb, W / 2, 1060);

  ctx.fillStyle = "#7a2e0e";
  ctx.font = "70px Pacifico";
  fitWidth(ctx, name, W - 140);
  ctx.fillText(name, W / 2, 1185);
  ctx.font = "28px Poppins SemiBold";
  const line = `${dateLabel}  •  ${groupName}`;
  fitWidth(ctx, line, W - 120);
  ctx.fillText(line, W / 2, 1250);
  await drawLogo(ctx, logo, W / 2, 40, 90, "center");
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 23. Pop art: halftone dots, comic burst, outlined person, speech bubble ----------

export async function renderPopArt(input: Design7Input): Promise<Buffer> {
  const { photo, cutout, name, dateLabel, groupName, credit, logo } = input;
  const w = flyerWords(input.lang);
  const { day, month } = dateOf(dateLabel);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "pop");
  ctx.fillStyle = "#ffd60a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ff4d6d";
  for (let y = 0; y < H; y += 26) {
    for (let x = (y / 26) % 2 ? 13 : 0; x < W; x += 26) {
      const r = Math.max(0, ((x + y) / (W + H)) * 11 - 1.5);
      if (r <= 0.3) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.save();
  burst(ctx, W / 2, 660, 560, 400, 16, rand);
  ctx.fillStyle = "#111111";
  ctx.translate(12, 12);
  ctx.fill();
  ctx.restore();
  burst(ctx, W / 2, 660, 560, 400, 16, rng(name + "pop"));
  ctx.fillStyle = "#3ab0ff";
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#111111";
  ctx.stroke();

  if (cutout) {
    const layer = personLayer(await loadImage(cutout), 760, 900, 1);
    const ink = silhouette(layer, "#111111");
    ctx.drawImage(ink, 160 + 16, 290 + 14);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) ctx.drawImage(ink, 160 + Math.cos(a) * 9, 290 + Math.sin(a) * 9);
    ctx.drawImage(layer, 160, 290);
  } else if (photo) {
    ctx.save();
    ctx.translate(W / 2, 700);
    ctx.rotate(-0.04);
    ctx.fillStyle = "#111111";
    ctx.fillRect(-300 + 16, -360 + 16, 600, 720);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-300, -360, 600, 720);
    cover(ctx, await loadImage(photo), -282, -342, 564, 684, 0.5, 0.25);
    ctx.lineWidth = 8;
    ctx.strokeRect(-300, -360, 600, 720);
    ctx.restore();
  }

  // Title across the top.
  ctx.save();
  ctx.translate(W / 2, 270);
  ctx.rotate(-0.05);
  ctx.textAlign = "center";
  ctx.font = "170px Anton";
  const hb = w.happyBirthday.toUpperCase();
  fitWidth(ctx, hb, W - 120);
  hardText(ctx, hb, 0, 0, "#ffffff", "#111111", 16, 12);
  ctx.restore();

  // Date burst.
  ctx.save();
  ctx.translate(890, 470);
  ctx.rotate(0.12);
  burst(ctx, 0, 0, 135, 100, 12, rand);
  ctx.fillStyle = "#e5383b";
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = "92px Anton";
  hardText(ctx, String(day), 0, 22, "#ffffff", "#111111", 8, 5);
  ctx.font = "30px Anton";
  hardText(ctx, w.months[month]!.slice(0, 3).toUpperCase(), 0, 64, "#ffffff", "#111111", 6, 3);
  ctx.restore();

  // Speech bubble with the name.
  const bx = 70,
    by = 1110,
    bw = W - 140,
    bh = 175;
  ctx.fillStyle = "#111111";
  roundRect(ctx, bx + 10, by + 10, bw, bh, 40);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, bx, by, bw, bh, 40);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W / 2 + 120, by + 4);
  ctx.lineTo(W / 2 + 190, by - 60);
  ctx.lineTo(W / 2 + 200, by + 4);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#111111";
  roundRect(ctx, bx, by, bw, bh, 40);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(W / 2 + 124, by - 2, 72, 9);
  ctx.beginPath();
  ctx.moveTo(W / 2 + 120, by + 2);
  ctx.lineTo(W / 2 + 190, by - 60);
  ctx.lineTo(W / 2 + 200, by + 2);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#111111";
  ctx.font = "78px Anton";
  fitWidth(ctx, name.toUpperCase(), bw - 80);
  ctx.fillText(name.toUpperCase(), W / 2, by + 92);
  ctx.font = "28px Poppins SemiBold";
  const line = `${dateLabel}  •  ${groupName}`;
  fitWidth(ctx, line, bw - 80);
  ctx.fillText(line, W / 2, by + 140);
  await drawLogo(ctx, logo, 36, 24, 80);
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 24. Y2K: night gradient, neon grid floor, chrome lettering ----------

export async function renderY2K(input: Design7Input): Promise<Buffer> {
  const { photo, cutout, name, dateLabel, groupName, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "y2k");
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#07021c");
  sky.addColorStop(0.55, "#2d0a5c");
  sky.addColorStop(1, "#8a2be2");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Neon grid floor.
  const horizon = 860;
  ctx.strokeStyle = "rgba(255,79,216,0.75)";
  ctx.lineWidth = 2;
  for (let i = -14; i <= 14; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * 30, horizon);
    ctx.lineTo(W / 2 + i * 260, H);
    ctx.stroke();
  }
  for (let k = 0; k < 12; k++) {
    const y = horizon + Math.pow(k / 11, 2) * (H - horizon);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  const haze = ctx.createLinearGradient(0, horizon - 60, 0, horizon + 80);
  haze.addColorStop(0, "rgba(255,79,216,0)");
  haze.addColorStop(0.5, "rgba(255,79,216,0.35)");
  haze.addColorStop(1, "rgba(255,79,216,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - 60, W, 140);
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.6})`;
    ctx.fillRect(rand() * W, rand() * horizon, 2, 2);
  }

  // Chrome word, slanted.
  ctx.save();
  ctx.transform(1, 0, -0.18, 1, 80, 0);
  ctx.textAlign = "center";
  ctx.font = "250px Anton";
  const big = w.birthday.toUpperCase();
  fitWidth(ctx, big, W - 80);
  ctx.shadowColor = "rgba(255,79,216,0.8)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = metal(ctx, 200, 430, CHROME);
  ctx.fillText(big, W / 2, 430);
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.strokeText(big, W / 2, 430);
  ctx.restore();
  ctx.save();
  ctx.translate(250, 190);
  ctx.rotate(-0.1);
  ctx.font = "112px Pacifico";
  fitWidth(ctx, w.happy, 520);
  ctx.textAlign = "center";
  ctx.shadowColor = "#ff4fd8";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "#ff8be8";
  ctx.fillText(w.happy, 0, 0);
  ctx.restore();

  if (cutout) {
    withShadow(ctx, personLayer(await loadImage(cutout), 700, 700, 0.88), W / 2 - 350, 470, "rgba(255,79,216,0.7)", 50);
  } else if (photo) {
    const px = W / 2 - 270,
      py = 470;
    ctx.save();
    ctx.shadowColor = "rgba(255,79,216,0.8)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = metal(ctx, py, py + 620, CHROME);
    roundRect(ctx, px - 14, py - 14, 568, 648, 46);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, px, py, 540, 620, 36);
    ctx.clip();
    cover(ctx, await loadImage(photo), px, py, 540, 620, 0.5, 0.25);
    ctx.restore();
  }
  for (let i = 0; i < 9; i++) sparkle(ctx, 60 + rand() * (W - 120), 120 + rand() * 900, 10 + rand() * 22, "#ffffff");

  // Name in a glossy pill.
  ctx.textAlign = "center";
  ctx.font = "56px Poppins ExtraBold";
  fitWidth(ctx, name, W - 220);
  const pw = Math.min(W - 120, ctx.measureText(name).width + 110);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  roundRect(ctx, W / 2 - pw / 2, 1120, pw, 100, 50);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, W / 2, 1190);
  ctx.font = "28px Poppins SemiBold";
  const line = `${dateLabel}  •  ${groupName}`;
  fitWidth(ctx, line, W - 120);
  ctx.fillStyle = "#ffd6f6";
  ctx.fillText(line, W / 2, 1265);
  await drawLogo(ctx, logo, 40, 30, 80);
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 25. Frosted glass: blurred photo behind a glass card ----------

export async function renderGlass(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#3d2b52";
  ctx.fillRect(0, 0, W, H);
  const img = photo ? await loadImage(photo) : undefined;
  if (img) {
    ctx.save();
    ctx.filter = "blur(45px) saturate(1.4) brightness(0.8)";
    cover(ctx, img, -120, -120, W + 240, H + 240, 0.5, 0.4);
    ctx.restore();
  }
  const shade = ctx.createLinearGradient(0, 0, W, H);
  shade.addColorStop(0, "rgba(120,60,200,0.25)");
  shade.addColorStop(1, "rgba(20,10,40,0.35)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // Glass card.
  const gx = 80,
    gy = 120,
    gw = W - 160,
    gh = 1120;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 50;
  const glass = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
  glass.addColorStop(0, "rgba(255,255,255,0.32)");
  glass.addColorStop(1, "rgba(255,255,255,0.1)");
  ctx.fillStyle = glass;
  roundRect(ctx, gx, gy, gw, gh, 52);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 2;
  roundRect(ctx, gx, gy, gw, gh, 52);
  ctx.stroke();

  if (img) {
    ctx.save();
    roundRect(ctx, gx + 50, gy + 50, gw - 100, 640, 38);
    ctx.clip();
    cover(ctx, img, gx + 50, gy + 50, gw - 100, 640, 0.5, 0.25);
    ctx.restore();
  }
  // Date on a small glass pill over the photo.
  ctx.font = "28px Poppins SemiBold";
  const date = dateLabel.toUpperCase();
  const dw = ctx.measureText(date).width + 3 * date.length + 48;
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  roundRect(ctx, gx + 80, gy + 80, dw, 56, 28);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  spaced(ctx, date, gx + 104, gy + 118, 3, "left");

  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 14;
  ctx.font = "78px Playfair Display Bold";
  fitWidth(ctx, w.happyBirthday, gw - 80);
  ctx.fillText(w.happyBirthday, W / 2, gy + 795);
  ctx.font = "50px Poppins SemiBold";
  fitWidth(ctx, name, gw - 80);
  ctx.fillText(name, W / 2, gy + 870);
  ctx.shadowColor = "transparent";
  const { lines, size } = fitWish(ctx, wish, "Poppins", 25, 19, gw - 140, 3);
  ctx.font = `${size}px Poppins`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, gy + 930 + i * size * 1.45));
  ctx.font = "22px Poppins SemiBold";
  fitWidth(ctx, groupName.toUpperCase(), gw - 120, 4);
  spaced(ctx, groupName.toUpperCase(), W / 2, gy + gh - 34, 4, "center");
  await drawLogo(ctx, logo, W / 2, 26, 80, "center");
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 26. Paper collage: torn photo, tape, cut-out letters, date stamp ----------

const SCRAPS = [
  { bg: "#111111", fg: "#ffffff", font: "Anton" },
  { bg: "#ffffff", fg: "#111111", font: "Playfair Display Black" },
  { bg: "#e5383b", fg: "#ffffff", font: "Poppins ExtraBold" },
  { bg: "#f6e27f", fg: "#111111", font: "Permanent Marker" },
  { bg: "#ffffff", fg: "#e5383b", font: "Anton" },
  { bg: "#2f6fdb", fg: "#ffffff", font: "Playfair Display Black" },
];

/** A word in ransom-note letters, each on its own scrap of paper, centred on (cx, cy). */
function ransom(ctx: Ctx, word: string, cx: number, cy: number, size: number, maxWidth: number, rand: () => number) {
  const letters = [...word.toUpperCase()];
  const step = Math.min(size * 0.9, maxWidth / letters.length);
  const s = step / 0.9;
  let x = cx - (step * letters.length) / 2 + step / 2;
  for (const ch of letters) {
    const scrap = SCRAPS[Math.floor(rand() * SCRAPS.length)]!;
    if (ch !== " ") {
      ctx.save();
      ctx.translate(x, cy + (rand() - 0.5) * s * 0.12);
      ctx.rotate((rand() - 0.5) * 0.22);
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = scrap.bg;
      ctx.fillRect(-step * 0.47, -s * 0.52, step * 0.94, s * 1.02);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = scrap.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.round(s * 0.72)}px ${scrap.font}`;
      fitWidth(ctx, ch, step * 0.8);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }
    x += step;
  }
}

export async function renderCollage(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, credit, logo } = input;
  const w = flyerWords(input.lang);
  const { day, month } = dateOf(dateLabel);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "collage");
  ctx.fillStyle = "#c9a37a";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(90,55,20,0.18)" : "rgba(255,240,215,0.2)";
    ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 3, 1 + rand() * 3);
  }

  // A torn sheet behind, then the torn photo.
  ctx.save();
  ctx.translate(W / 2, 520);
  ctx.rotate(0.04);
  torn(ctx, -360, -380, 720, 760, 16, rand);
  ctx.fillStyle = "#f4efe4";
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.restore();
  if (photo) {
    ctx.save();
    ctx.translate(W / 2, 510);
    ctx.rotate(-0.035);
    torn(ctx, -310, -340, 620, 680, 12, rand);
    ctx.clip();
    cover(ctx, await loadImage(photo), -310, -340, 620, 680, 0.5, 0.25);
    ctx.restore();
  }
  tape(ctx, W / 2 - 290, 190, 190, 52, -0.6, "rgba(233,245,160,0.82)");
  tape(ctx, W / 2 + 300, 210, 190, 52, 0.55, "rgba(233,245,160,0.82)");

  // Date stamp.
  ctx.save();
  ctx.translate(880, 820);
  ctx.rotate(0.2);
  ctx.strokeStyle = "rgba(201,42,42,0.9)";
  ctx.fillStyle = "rgba(201,42,42,0.9)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 118, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.font = "86px Anton";
  ctx.fillText(String(day), 0, 22);
  ctx.font = "24px Poppins ExtraBold";
  ctx.fillText(w.months[month]!.toUpperCase(), 0, 58);
  ctx.font = "19px Poppins SemiBold";
  circleText(ctx, `${w.happyBirthday.toUpperCase()} • ${w.happyBirthday.toUpperCase()}`, 0, 0, 92);
  ctx.restore();

  ransom(ctx, w.happy, W / 2, 985, 120, W - 220, rand);
  ransom(ctx, w.birthday, W / 2, 1110, 120, W - 80, rand);

  // Name on a torn strip.
  ctx.font = "54px Permanent Marker";
  fitWidth(ctx, name, W - 220);
  const nw = ctx.measureText(name).width + 70;
  ctx.save();
  ctx.translate(W / 2, 1222);
  ctx.rotate(-0.015);
  torn(ctx, -nw / 2, -40, nw, 80, 8, rand);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 0, 4);
  ctx.restore();

  ctx.save();
  ctx.translate(140, 70);
  ctx.rotate(-0.05);
  ctx.font = "24px Poppins SemiBold";
  const g = groupName.toUpperCase();
  fitWidth(ctx, g, 520);
  const gw = ctx.measureText(g).width + 40 + (logo ? 70 : 0);
  ctx.fillStyle = "#111111";
  ctx.fillRect(-90, -34, gw, 68);
  await drawLogo(ctx, logo, -80, -28, 56);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(g, -90 + 20 + (logo ? 70 : 0), 2);
  ctx.restore();
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 27. Marker scribble: red scribble ball, marker lettering ----------

export async function renderScribble(input: Design7Input): Promise<Buffer> {
  const { photo, cutout, name, dateLabel, groupName, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "scribble");
  ctx.fillStyle = "#f7f3ea";
  ctx.fillRect(0, 0, W, H);

  // The scribble: lots of loose marker loops.
  ctx.strokeStyle = "rgba(229,56,59,0.9)";
  ctx.lineCap = "round";
  const cx = W / 2,
    cy = 690;
  for (let i = 0; i < 46; i++) {
    ctx.lineWidth = 7 + rand() * 9;
    ctx.beginPath();
    const r = 150 + rand() * 260,
      a = rand() * Math.PI * 2,
      sx = 0.75 + rand() * 0.45;
    ctx.ellipse(cx + (rand() - 0.5) * 120, cy + (rand() - 0.5) * 120, r * sx, r, a, rand() * 2, rand() * 2 + 4.6);
    ctx.stroke();
  }

  if (cutout) {
    withShadow(ctx, personLayer(await loadImage(cutout), 720, 860, 0.9), W / 2 - 360, 1150 - 860, "rgba(0,0,0,0.25)", 30);
  } else if (photo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 300, 0, Math.PI * 2);
    ctx.clip();
    cover(ctx, await loadImage(photo), cx - 300, cy - 300, 600, 600, 0.5, 0.25);
    ctx.restore();
  }

  ctx.fillStyle = "#111111";
  ctx.textAlign = "left";
  ctx.font = "32px Poppins SemiBold";
  ctx.fillText(dateLabel, 52, 76);
  ctx.font = "22px Poppins";
  fitWidth(ctx, groupName, W - 52 - 160);
  ctx.fillText(groupName, 52, 110);
  await drawLogo(ctx, logo, W - 48, 34, 86, "right");

  ctx.save();
  ctx.translate(W / 2, 250);
  ctx.rotate(-0.04);
  ctx.textAlign = "center";
  ctx.font = "112px Permanent Marker";
  fitWidth(ctx, w.happyBirthday, W - 100);
  ctx.fillText(w.happyBirthday, 0, 0);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = "84px Permanent Marker";
  fitWidth(ctx, name, W - 120);
  const nw = ctx.measureText(name).width;
  ctx.fillText(name, W / 2, 1238);
  ctx.strokeStyle = "#e5383b";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(W / 2 - nw / 2, 1262);
  ctx.quadraticCurveTo(W / 2, 1248, W / 2 + nw / 2 + 20, 1258);
  ctx.stroke();
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

// ---------- 28. Aurora: northern lights over a night sky, glowing round photo ----------

export async function renderAurora(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "aurora");
  ctx.fillStyle = "#050b1f";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.7})`;
    const s = rand() * 2.4;
    ctx.fillRect(rand() * W, rand() * H * 0.8, s, s);
  }
  // Light curtains: wide wavy strokes, blurred.
  ctx.save();
  ctx.filter = "blur(50px)";
  ctx.globalCompositeOperation = "lighter";
  const bands: Array<[string, number, number]> = [
    ["rgba(46,230,166,0.55)", 330, 0],
    ["rgba(0,180,216,0.45)", 450, 1.7],
    ["rgba(123,47,247,0.5)", 230, 3.1],
    ["rgba(255,78,205,0.35)", 560, 4.4],
  ];
  for (const [colour, base, phase] of bands) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 150;
    ctx.beginPath();
    for (let x = -100; x <= W + 100; x += 20) {
      const y = base + Math.sin(x / 170 + phase) * 90 + Math.sin(x / 61 + phase * 2) * 25;
      x === -100 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Hills along the bottom.
  ctx.fillStyle = "#030614";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, 1080 + Math.sin(x / 150) * 40 + Math.sin(x / 47) * 12);
  ctx.lineTo(W, H);
  ctx.fill();

  const pr = 245,
    py = 545;
  ctx.save();
  ctx.shadowColor = "rgba(125,249,255,0.9)";
  ctx.shadowBlur = 60;
  ctx.fillStyle = "#e8fbff";
  ctx.beginPath();
  ctx.arc(W / 2, py, pr + 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (photo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, py, pr, 0, Math.PI * 2);
    ctx.clip();
    cover(ctx, await loadImage(photo), W / 2 - pr, py - pr, pr * 2, pr * 2, 0.5, 0.25);
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "70px Playfair Display Bold";
  const hb = w.happyBirthday.toUpperCase();
  fitWidth(ctx, hb, W - 120, 8);
  spaced(ctx, hb, W / 2, 210, 8, "center");

  ctx.save();
  ctx.shadowColor = "rgba(125,249,255,0.8)";
  ctx.shadowBlur = 24;
  ctx.font = "120px Great Vibes";
  fitWidth(ctx, name, W - 120);
  ctx.fillText(name, W / 2, 935);
  ctx.restore();
  ctx.fillStyle = "#a5f3fc";
  ctx.font = "26px Poppins SemiBold";
  const line = `${dateLabel}  •  ${groupName}`.toUpperCase();
  fitWidth(ctx, line, W - 140, 4);
  spaced(ctx, line, W / 2, 1010, 4, "center");
  const { lines, size } = fitWish(ctx, wish, "Poppins", 25, 19, W - 220, 3);
  ctx.font = `${size}px Poppins`;
  ctx.fillStyle = "rgba(220,235,255,0.9)";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, 1100 + i * size * 1.5));
  await drawLogo(ctx, logo, W / 2, 40, 80, "center");
  creditLine(ctx, credit, "", "center");
  return c.encode("jpeg", 90);
}

/** What each design is drawn by, keyed by its layout in themes.ts. */
export const DESIGNS_10 = {
  editorial: renderEditorial,
  swiss: renderSwiss,
  minimal: renderMinimal,
  retro: renderRetro,
  popart: renderPopArt,
  y2k: renderY2K,
  glass: renderGlass,
  collage: renderCollage,
  scribble: renderScribble,
  aurora: renderAurora,
};

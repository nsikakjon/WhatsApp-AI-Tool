// Seven more birthday designs (12 to 18), drawn from jay's inspiration pictures.
// Three of them stand the person in front of the design using their cut-out
// photo (see cutout.ts); without one, they fall back to the plain photo.
// Each takes the same input as the designs in designs4.ts, plus the logo.
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import {
  balloon,
  circleText,
  cover,
  creditLine,
  fadeSides,
  fadeTop,
  fadedPhoto,
  fitFont,
  fitWish,
  GOLD,
  H,
  metal,
  parseDate,
  personLayer,
  ringText,
  rng,
  sparkle,
  spaced,
  W,
  withShadow,
  wrap,
  type DesignInput,
} from "./designs4.js";
import { fitWidth, flyerWords } from "./words.js";

type Ctx = SKRSContext2D;

export interface Design7Input extends DesignInput {
  logo?: Uint8Array;
}

/** "14 October" -> day 14, month 9; anything unreadable falls back to 1 January. */
function dateOf(label: string) {
  return parseDate(label) ?? { day: 1, month: 0 };
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The group logo in a box, keeping its shape. */
async function drawLogo(ctx: Ctx, logo: Uint8Array | undefined, x: number, y: number, max: number, align: "left" | "right" | "center" = "left") {
  if (!logo) return;
  const img = await loadImage(logo);
  const s = Math.min(max / img.width, max / img.height);
  const w = img.width * s,
    h = img.height * s;
  const lx = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  ctx.drawImage(img, lx, y, w, h);
}

/** The person standing in a box: their cut-out if there is one, else the photo faded at the sides and top. */
async function standing(ctx: Ctx, input: DesignInput, x: number, y: number, w: number, h: number, shadow: string) {
  if (input.cutout) {
    withShadow(ctx, personLayer(await loadImage(input.cutout), w, h, 1), x, y, shadow, 34);
  } else if (input.photo) {
    const layer = fadedPhoto(await loadImage(input.photo), w, h, [fadeSides(0.14), fadeTop(0, 0.22)], 0.5, 0.2);
    ctx.drawImage(layer, x, y);
  }
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function heart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.35, y - s * 0.85, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.35, y - s * 0.85, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
  ctx.fill();
}

/** A photo in a white instant-camera frame, tilted by `angle`, with a soft shadow. */
function polaroid(ctx: Ctx, img: Image, cx: number, cy: number, w: number, h: number, angle: number, border = 22, chin = 70) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.rect(-w / 2 + border, -h / 2 + border, w - border * 2, h - border - chin);
  ctx.clip();
  cover(ctx, img, -w / 2 + border, -h / 2 + border, w - border * 2, h - border - chin, 0.5, 0.25);
  ctx.restore();
}

// ---------- 12. Gold portrait: big white lettering, date box, person on the right ----------

export async function renderGoldPortrait(input: Design7Input): Promise<Buffer> {
  const { name, dateLabel, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "goldpro");
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#b7843a");
  bg.addColorStop(0.55, "#8c5a22");
  bg.addColorStop(1, "#5e3a12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Crumpled-paper facets.
  for (let i = 0; i < 70; i++) {
    const x = rand() * W,
      y = rand() * H,
      r = 120 + rand() * 260;
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,230,180,${0.03 + rand() * 0.07})` : `rgba(40,20,0,${0.03 + rand() * 0.08})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * r * 2, y + (rand() - 0.5) * r * 2);
    ctx.lineTo(x + (rand() - 0.5) * r * 2, y + (rand() - 0.5) * r * 2);
    ctx.fill();
  }

  await standing(ctx, input, W - 700, H - 900, 740, 900, "rgba(40,20,0,0.45)");

  await drawLogo(ctx, logo, 60, 50, 100);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.font = "190px Poppins SemiBold";
  const happy = w.happy.toUpperCase();
  fitWidth(ctx, happy, W - 52 - 26 - 200);
  ctx.fillText(happy, 52, 330);
  const happyW = ctx.measureText(happy).width;
  fitFont(ctx, w.birthday.toUpperCase(), "Poppins SemiBold", 200, 80, W - 110);
  ctx.fillText(w.birthday.toUpperCase(), 52, 520);

  // Date box beside "HAPPY".
  const d = dateOf(dateLabel);
  const bx = 52 + happyW + 26,
    bw = Math.min(220, W - bx - 50);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(bx, 182, bw, 150);
  ctx.fillStyle = "#8c5a22";
  ctx.textAlign = "center";
  fitFont(ctx, w.ordinal(d.day), "Poppins SemiBold", 56, 30, bw - 20);
  ctx.fillText(w.ordinal(d.day), bx + bw / 2, 250);
  fitFont(ctx, w.months[d.month]!.slice(0, 3).toUpperCase(), "Poppins SemiBold", 56, 30, bw - 20);
  ctx.fillText(w.months[d.month]!.slice(0, 3).toUpperCase(), bx + bw / 2, 312);

  // The birthday message, then the name with a bar beside it.
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const lines = fitWish(ctx, wish?.toUpperCase(), "Poppins", 26, 18, 420, 6).lines;
  lines.forEach((l, i) => ctx.fillText(l, 60, 600 + i * 38));

  ctx.font = "44px Poppins SemiBold";
  const nameLines = wrap(ctx, name.toUpperCase(), 380).slice(0, 3);
  let top = Math.max(880, 600 + lines.length * 38 + 60);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(60, top, 12, nameLines.length * 54 - 8);
  nameLines.forEach((l, i) => {
    fitFont(ctx, l, "Poppins SemiBold", 44, 26, 380);
    ctx.fillText(l, 92, top + 42 + i * 54);
  });
  top += nameLines.length * 54 + 30;
  ctx.fillStyle = "#ffe2a8";
  ctx.font = "26px Poppins";
  wrap(ctx, groupName, 380)
    .slice(0, 2)
    .forEach((l, i) => ctx.fillText(l, 60, top + i * 34));

  creditLine(ctx, credit, "rgba(255,255,255,0.85)", "left", 60, "rgba(0,0,0,0.6)");
  return c.encode("jpeg", 90);
}

// ---------- 13. Red and peach: bold red serif title, date seal, person in front ----------

export async function renderRedPeach(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "peach");
  const RED = "#cf1f2e";
  ctx.fillStyle = "#f7dcc6";
  ctx.fillRect(0, 0, W, H);
  // The photo again, huge and soft, as a warm backdrop.
  if (photo) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.filter = "blur(10px)";
    cover(ctx, await loadImage(photo), -120, -60, W + 240, H + 120, 0.5, 0.3);
    ctx.restore();
  }
  const wash = ctx.createRadialGradient(W / 2, 520, 100, W / 2, 620, 900);
  wash.addColorStop(0, "rgba(255,240,228,0.75)");
  wash.addColorStop(1, "rgba(240,180,140,0.55)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  // Blurred golden petals.
  for (let i = 0; i < 12; i++) {
    ctx.save();
    ctx.translate(rand() * W, rand() * H);
    ctx.rotate(rand() * Math.PI);
    ctx.filter = `blur(${rand() > 0.5 ? 4 : 0}px)`;
    ctx.fillStyle = rand() > 0.5 ? "rgba(240,150,40,0.85)" : "rgba(250,190,90,0.85)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 14 + rand() * 18, 30 + rand() * 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  await drawLogo(ctx, logo, 50, 44, 100);
  ctx.textAlign = "center";
  ctx.fillStyle = RED;
  ctx.font = "42px Poppins SemiBold";
  // In French the big words are "Bonne fête", as birthdays are wished across French-speaking Africa.
  spaced(ctx, w.lang === "fr" ? "JOYEUX ANNIVERSAIRE" : "HAPPY", W / 2, 180, 8, "center");
  ctx.font = "250px Playfair Display Black";
  ctx.fillText(w.lang === "fr" ? "Bonne" : "Birth", W / 2 - 10, 410);
  ctx.fillText(w.lang === "fr" ? "Fête" : "Day", W / 2 + 70, 630);

  // The person, in front of "Day".
  if (input.cutout) {
    // Low enough that "Day" stays readable above their head.
    withShadow(ctx, personLayer(await loadImage(input.cutout), 700, 740, 1), (W - 700) / 2, H - 740, "rgba(120,40,20,0.35)", 34);
  } else if (photo) {
    const layer = fadedPhoto(await loadImage(photo), 640, 760, [fadeSides(0.15), fadeTop(0, 0.25)], 0.5, 0.2);
    ctx.drawImage(layer, (W - 640) / 2, H - 760);
  }

  // Date seal on the left.
  const d = dateOf(dateLabel),
    sx = 190,
    sy = 860;
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(sx, sy, 78, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "72px Poppins ExtraBold";
  ctx.fillText(String(d.day).padStart(2, "0"), sx, sy + 26);
  ctx.fillStyle = RED;
  ctx.font = "22px Poppins SemiBold";
  ringText(ctx, w.months[d.month]!.toUpperCase(), sx, sy, 104);

  // Name tag on the right.
  const [first = name, ...rest] = name.trim().split(/\s+/);
  const tag = fitFont(ctx, first.toUpperCase(), "Poppins ExtraBold", 42, 26, 250);
  const tw = ctx.measureText(first.toUpperCase()).width + 36;
  ctx.fillStyle = RED;
  roundRect(ctx, 760, 820, tw, tag + 26, 10);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(first.toUpperCase(), 778, 820 + tag + 6);
  ctx.fillStyle = "#5a1a12";
  if (rest.length) {
    fitFont(ctx, rest.join(" ").toUpperCase(), "Poppins ExtraBold", 36, 22, 290);
    ctx.fillText(rest.join(" ").toUpperCase(), 772, 820 + tag + 70);
  }
  ctx.font = "24px Poppins SemiBold";
  wrap(ctx, groupName, 280)
    .slice(0, 2)
    .forEach((l, i) => ctx.fillText(l, 772, 820 + tag + 120 + i * 32));

  creditLine(ctx, credit, "rgba(255,255,255,0.9)", "center", W / 2, "rgba(0,0,0,0.6)");
  return c.encode("jpeg", 90);
}

// ---------- 14. Black and gold rings: round photo in a gold ring, date pill ----------

export async function renderBlackGold(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "rings");
  const bg = ctx.createRadialGradient(W / 2, 450, 100, W / 2, 600, 1000);
  bg.addColorStop(0, "#2a2a2a");
  bg.addColorStop(1, "#050505");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Dark discs with fine gold rings, top right and bottom left.
  for (const [cx, cy, r0] of [
    [990, 230, 300],
    [80, 1190, 320],
    [1060, 1100, 200],
  ] as const) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = "#121212";
    ctx.beginPath();
    ctx.arc(cx, cy, r0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    for (let r = 40; r < r0; r += 16) {
      ctx.strokeStyle = `rgba(212,170,80,${0.15 + rand() * 0.35})`;
      ctx.lineWidth = rand() > 0.8 ? 3 : 1.2;
      const a0 = rand() * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + Math.PI * (0.6 + rand() * 1.2));
      ctx.stroke();
    }
  }
  // Gold dust.
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgba(240,200,110,${rand() * 0.8})`;
    ctx.beginPath();
    ctx.arc(rand() * W, rand() * H, rand() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Photo in a gold ring.
  const px = W / 2,
    py = 450,
    pr = 290;
  ctx.save();
  ctx.shadowColor = "rgba(255,200,90,0.45)";
  ctx.shadowBlur = 50;
  ctx.fillStyle = metal(ctx, py - pr - 30, py + pr + 30, GOLD);
  ctx.beginPath();
  ctx.arc(px, py, pr + 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#222";
  ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  if (photo) cover(ctx, await loadImage(photo), px - pr, py - pr, pr * 2, pr * 2, 0.5, 0.25);
  ctx.restore();
  ctx.strokeStyle = metal(ctx, py - pr - 60, py + pr + 60, GOLD);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, py, pr + 52, 0, Math.PI * 2);
  ctx.stroke();
  sparkle(ctx, px + pr * 0.72, py - pr * 0.72, 26, "#fff3c4");
  sparkle(ctx, px - pr * 0.8, py + pr * 0.6, 16, "#fff3c4");

  // Date pill.
  const d = dateOf(dateLabel);
  const dateText = `${w.lang === "fr" && d.day === 1 ? "1er" : d.day} ${w.months[d.month]!.toUpperCase()}`;
  ctx.font = "30px Poppins SemiBold";
  const dw = ctx.measureText(dateText).width + 70;
  ctx.fillStyle = metal(ctx, 830, 890, GOLD);
  roundRect(ctx, (W - dw) / 2, 830, dw, 60, 12);
  ctx.fill();
  ctx.fillStyle = "#1a1206";
  ctx.textAlign = "center";
  ctx.fillText(dateText, W / 2, 872);

  // "Ada's Birthday" and the group name.
  ctx.fillStyle = metal(ctx, 920, 1010, GOLD);
  const title = `·${w.birthdayOf(firstName(name))}·`;
  fitFont(ctx, title, "Playfair Display Bold", 88, 50, W - 120);
  ctx.fillText(title, W / 2, 1000);
  ctx.fillStyle = "#e9c46a";
  fitFont(ctx, `- ${groupName} -`, "Playfair Display Bold", 40, 24, W - 160);
  ctx.fillText(`- ${groupName} -`, W / 2, 1066);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  fitWish(ctx, wish, "Poppins", 24, 18, 820, 3).lines.forEach((l, i) => ctx.fillText(l, W / 2, 1130 + i * 34));

  await drawLogo(ctx, logo, 50, 44, 100);
  creditLine(ctx, credit, "rgba(255,255,255,0.6)");
  return c.encode("jpeg", 90);
}

// ---------- 15. White confetti: round photo, red "HAPPY", script "Birthday" ----------

export async function renderWhiteConfetti(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "confetti");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const px = W / 2,
    py = 430,
    pr = 250;
  // Confetti around the photo.
  const colours = ["#e94f37", "#f6c90e", "#3ec1d3", "#ff8fab", "#7bd389", "#ff9f1c"];
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2,
      dist = pr + 40 + rand() * 260;
    const x = px + Math.cos(a) * dist,
      y = py + Math.sin(a) * dist * 0.85;
    if (y > 760) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    ctx.fillStyle = colours[Math.floor(rand() * colours.length)]!;
    ctx.fillRect(-6 - rand() * 8, -4, 14 + rand() * 16, 8 + rand() * 6);
    ctx.restore();
  }
  ctx.strokeStyle = "#e6e6e6";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, py, pr + 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#eeeeee";
  ctx.beginPath();
  ctx.arc(px, py, pr + 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, Math.PI * 2);
  ctx.clip();
  if (photo) cover(ctx, await loadImage(photo), px - pr, py - pr, pr * 2, pr * 2, 0.5, 0.25);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#e8452c";
  ctx.font = "150px Poppins ExtraBold";
  ctx.fillText(w.happy.toUpperCase(), W / 2, 880);
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "190px Great Vibes";
  fitWidth(ctx, w.birthday, W - 120);
  ctx.fillText(w.birthday, W / 2 + 30, 1010);

  fitFont(ctx, name, "Poppins SemiBold", 48, 30, W - 140);
  ctx.fillText(name, W / 2, 1090);
  ctx.fillStyle = "#666666";
  fitWish(ctx, wish, "Poppins", 24, 18, 800, 3).lines.forEach((l, i) => ctx.fillText(l, W / 2, 1140 + i * 34));
  ctx.fillStyle = "#e8452c";
  ctx.font = "26px Poppins SemiBold";
  ctx.fillText(`${dateLabel}  •  ${groupName}`, W / 2, 1290);

  await drawLogo(ctx, logo, 50, 44, 110);
  creditLine(ctx, credit, "#999999");
  return c.encode("jpeg", 90);
}

// ---------- 16. Big date, blue: the day in huge numbers, person in front ----------

export async function renderBigDate(input: Design7Input): Promise<Buffer> {
  const { name, dateLabel, groupName, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "bigdate");
  const bg = ctx.createRadialGradient(W / 2, 500, 100, W / 2, 700, 1000);
  bg.addColorStop(0, "#2f6bff");
  bg.addColorStop(1, "#0a2a8f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Grungy texture.
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rand() * 0.06})`;
    ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 40, 1 + rand() * 3);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = "30px Poppins SemiBold";
  spaced(ctx, w.happyBirthday.toUpperCase(), W / 2, 80, 10, "center");

  // The day, huge, behind the person.
  const d = dateOf(dateLabel);
  const day = String(d.day);
  ctx.save();
  ctx.shadowColor = "rgba(0,20,80,0.5)";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  const size = fitFont(ctx, day, "Poppins ExtraBold", 640, 300, 860);
  ctx.fillText(day, W / 2 - 20, 160 + size * 0.75);
  const dayW = ctx.measureText(day).width;
  ctx.font = "80px Poppins SemiBold";
  ctx.textAlign = "left";
  ctx.fillText(w.ordinal(d.day).slice(day.length), W / 2 - 20 + dayW / 2 + 10, 250);
  ctx.restore();

  await standing(ctx, input, (W - 720) / 2 + 20, H - 920, 720, 920, "rgba(0,10,60,0.5)");

  // Heart bubbles.
  for (const [x, y, s] of [
    [150, 520, 110],
    [960, 800, 90],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.2);
    const g = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    g.addColorStop(0, "#7fb2ff");
    g.addColorStop(1, "#1f5fe0");
    ctx.fillStyle = g;
    ctx.shadowColor = "rgba(0,0,40,0.4)";
    ctx.shadowBlur = 20;
    roundRect(ctx, -s / 2, -s / 2, s, s, s * 0.28);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#ffffff";
    heart(ctx, 0, 4, s * 0.36);
    ctx.restore();
  }

  // Month seal.
  const sx = 150,
    sy = 880;
  ctx.fillStyle = "#ffffff";
  ctx.font = "20px Poppins SemiBold";
  ringText(ctx, w.happyBirthday, sx, sy, 92);
  ctx.textAlign = "center";
  ctx.font = "42px Poppins ExtraBold";
  ctx.fillText(w.ordinal(d.day), sx, sy - 4);
  ctx.font = "30px Poppins ExtraBold";
  const month = w.months[d.month]!.toUpperCase();
  fitWidth(ctx, month, 150);
  ctx.fillText(month, sx, sy + 34);

  // Darken the bottom so the words stay readable over the person.
  const fade = ctx.createLinearGradient(0, 1060, 0, H);
  fade.addColorStop(0, "rgba(10,42,143,0)");
  fade.addColorStop(0.45, "rgba(10,42,143,0.85)");
  fade.addColorStop(1, "rgba(8,30,110,0.97)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 1060, W, H - 1060);

  // "Birth day" bottom right, name bottom left.
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = "130px Poppins ExtraBold";
  ctx.fillText(w.lang === "fr" ? "Bonne" : "Birth", W - 50, 1170);
  ctx.fillText(w.lang === "fr" ? "fête" : "day", W - 50, 1290);
  ctx.textAlign = "left";
  ctx.fillStyle = "#3ec1ff";
  ctx.fillRect(60, 1196, 12, 76);
  ctx.fillStyle = "#ffffff";
  fitFont(ctx, name, "Poppins ExtraBold", 38, 24, 420);
  ctx.fillText(name, 90, 1230);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  fitFont(ctx, groupName, "Poppins SemiBold", 28, 18, 420);
  ctx.fillText(groupName, 90, 1268);

  await drawLogo(ctx, logo, W - 50, 40, 100, "right");
  creditLine(ctx, credit, "rgba(255,255,255,0.8)", "left", 60);
  return c.encode("jpeg", 90);
}

// ---------- 17. Polaroid note: tilted photo on cream, "Many more happy returns!" ----------

export async function renderPolaroidNote(input: Design7Input): Promise<Buffer> {
  const { photo, name, groupName, wish, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#f9ead6";
  ctx.fillRect(0, 0, W, H);
  // Soft leaves and a cloud.
  ctx.fillStyle = "#efd2ad";
  for (const [x, y, a] of [
    [70, 330, -0.6],
    [120, 260, -0.2],
    [180, 230, 0.2],
    [980, 1180, 2.6],
    [930, 1260, 3.0],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, -90, 34, 120, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = "#fbf1e4";
  for (const [x, y, r] of [
    [880, 1160, 120],
    [1000, 1120, 140],
    [760, 1230, 100],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (photo) polaroid(ctx, await loadImage(photo), W / 2 + 20, 400, 720, 660, -0.06, 26, 90);
  // Tape across the bottom-right corner.
  ctx.save();
  ctx.translate(800, 690);
  ctx.rotate(-0.12);
  ctx.fillStyle = "rgba(232,180,100,0.8)";
  ctx.fillRect(-110, -32, 220, 64);
  ctx.restore();
  ctx.fillStyle = "#c98a5c";
  sparkle(ctx, 850, 820, 22, "#d9a066");
  ctx.fillStyle = "#7a4a2b";
  heart(ctx, 940, 1000, 48);

  ctx.textAlign = "left";
  ctx.fillStyle = "#d39a6a";
  ctx.font = "46px Playfair Display Bold";
  ctx.fillText(w.lang === "fr" ? `pour ${firstName(name)},` : `dear, ${firstName(name)}`, 100, 840);
  ctx.fillStyle = "#6e4026";
  ctx.font = "84px Playfair Display Black";
  ctx.fillText(w.lang === "fr" ? "Joyeux" : "Many more", 100, 940);
  ctx.fillText(w.lang === "fr" ? "anniversaire !" : "happy returns!", 100, 1030);
  ctx.font = "30px Playfair Display Bold";
  const lines = fitWish(ctx, wish, "Playfair Display Bold", 32, 22, 760, 3).lines;
  lines.forEach((l, i) => ctx.fillText(l, 100, 1094 + i * 42));
  const y = 1094 + lines.length * 42 + 30;
  ctx.fillStyle = "#d39a6a";
  ctx.font = "28px Playfair Display Bold";
  ctx.fillText(w.lang === "fr" ? "Avec amour," : "With love,", 100, y);
  fitFont(ctx, groupName, "Playfair Display Bold", 30, 20, 640);
  ctx.fillText(groupName, 100, y + 40);

  await drawLogo(ctx, logo, W - 60, 1150, 120, "right");
  creditLine(ctx, credit, "#b07a52");
  return c.encode("jpeg", 90);
}

// ---------- 18. Orange balloons: framed photo, glossy balloons, sticker title ----------

export async function renderBalloons(input: Design7Input): Promise<Buffer> {
  const { photo, name, dateLabel, groupName, credit, logo } = input;
  const w = flyerWords(input.lang);
  const c = createCanvas(W, H),
    ctx = c.getContext("2d"),
    rand = rng(name + "balloons");
  // Orange rings radiating from the middle.
  ctx.fillStyle = "#ff7a00";
  ctx.fillRect(0, 0, W, H);
  for (let r = 1300; r > 0; r -= 70) {
    ctx.fillStyle = (r / 70) % 2 ? "#ff8c1a" : "#ff6a00";
    ctx.beginPath();
    ctx.arc(W / 2, 560, r, 0, Math.PI * 2);
    ctx.fill();
  }

  balloon(ctx, 170, 230, 100, "#3cc43c", "#1d7a1d", { blur: 1 });
  balloon(ctx, 920, 250, 90, "#ffd60a", "#c9a000", { blur: 1 });
  balloon(ctx, 150, 960, 105, "#ff2b2b", "#a30f0f", { blur: 1 });
  balloon(ctx, 980, 1000, 70, "#ff9f1c", "#c66a00", { blur: 4 });

  if (photo) polaroid(ctx, await loadImage(photo), W / 2, 500, 600, 640, 0, 22, 70);
  // Gold confetti over everything.
  for (let i = 0; i < 70; i++) {
    ctx.save();
    ctx.translate(200 + rand() * 680, 160 + rand() * 700);
    ctx.rotate(rand() * Math.PI);
    ctx.fillStyle = rand() > 0.5 ? "#ffd166" : "#f4a261";
    ctx.fillRect(-5, -2, 10, 4);
    ctx.restore();
  }

  // Sticker-style title: white outline and a drop shadow.
  const sticker = (text: string, x: number, y: number, fill: string) => {
    ctx.save();
    ctx.font = "150px Pacifico";
    fitWidth(ctx, text, W - 140);
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 8;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 26;
    ctx.strokeText(text, x, y);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  };
  sticker(w.happy, W / 2 - 60, 960, "#e3262f");
  sticker(w.birthday, W / 2 + 40, 1110, "#2e9a2e");

  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  fitFont(ctx, name, "Poppins ExtraBold", 58, 30, W - 140);
  ctx.strokeStyle = "rgba(120,40,0,0.6)";
  ctx.lineWidth = 8;
  ctx.strokeText(name, W / 2, 1210);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, W / 2, 1210);
  ctx.font = "28px Poppins SemiBold";
  ctx.fillText(`${dateLabel}  •  ${groupName}`, W / 2, 1262);

  await drawLogo(ctx, logo, W / 2, 30, 100, "center");
  creditLine(ctx, credit, "rgba(255,255,255,0.9)", "center", W / 2, "rgba(0,0,0,0.5)");
  return c.encode("jpeg", 90);
}

/** What each design is drawn by, keyed by its layout in themes.ts. */
export const DESIGNS_7 = {
  goldportrait: renderGoldPortrait,
  redpeach: renderRedPeach,
  blackgold: renderBlackGold,
  whiteconfetti: renderWhiteConfetti,
  bigdate: renderBigDate,
  polaroidnote: renderPolaroidNote,
  balloons: renderBalloons,
};

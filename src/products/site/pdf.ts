// Draws the daily progress report as an A4 PDF: the site's logo and name at
// the top, the day's summary, every update, the locations shared (with a
// tappable Google Maps link) and the photos.
// Pure drawing code: it takes the report, the logo and photo bytes, and
// returns the PDF's bytes. Nothing here is worked out by the AI.
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, PDFDocument, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { displayDate, lagosTime, locationsOf, mapsLink, placeLabel, reportCounts, type DailyReport } from "./report.js";
import type { SiteUpdate } from "./store.js";

// The fonts ship with the code (assets/fonts), so the PDF looks the same on
// Railway as on a laptop.
const fontDir = fileURLToPath(new URL("../../../assets/fonts/", import.meta.url));
const REGULAR = "Site Report Regular";
const BOLD = "Site Report Bold";
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  GlobalFonts.registerFromPath(`${fontDir}Poppins-Regular.ttf`, REGULAR);
  GlobalFonts.registerFromPath(`${fontDir}Poppins-SemiBold.ttf`, BOLD);
  fontsLoaded = true;
}

export interface ReportPdfInput {
  report: DailyReport;
  /** The site's logo, or null to leave it out. */
  logo: Uint8Array | null;
  /** Photo bytes by storage path. Photos missing here are left out of the PDF. */
  photos: Map<string, Uint8Array>;
}

/** Most photos one PDF shows, so a busy day doesn't make a huge file. */
export const MAX_PDF_PHOTOS = 24;

// A4 in points (1/72 inch).
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FOOTER_H = 24;

const GREEN = "#1f7a4d";
const INK = "#1d1d1f";
const MUTED = "#6b6b70";
const RULE = "#dcdce0";
const PHOTO_BG = "#f2f2f4";

const KIND_LABEL: Record<SiteUpdate["kind"], string> = {
  text: "message",
  photo: "photo",
  voice: "voice note",
  location: "location",
};

export async function renderReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  loadFonts();
  const { report } = input;
  const title = `${report.siteName}: progress report for ${displayDate(report.date)}`;

  // Load every picture before drawing, since drawing a page can't wait.
  const logo = input.logo ? await loadPicture(input.logo, 600) : null;
  const photoUpdates = report.updates.filter((u) => u.kind === "photo");
  const photos: Array<{ update: SiteUpdate; image: Image }> = [];
  for (const update of photoUpdates) {
    const bytes = update.photoPath ? input.photos.get(update.photoPath) : undefined;
    if (!bytes || photos.length >= MAX_PDF_PHOTOS) continue;
    const image = await loadPicture(bytes, 1200);
    if (image) photos.push({ update, image });
  }

  const doc = new PDFDocument({ title, creator: "yarnOga Site Reporter", encodingQuality: 80 });
  const page = new PageWriter(doc, `${report.siteName} · ${displayDate(report.date)}`);

  drawHeader(page, report, logo);

  if (report.updates.length === 0) {
    page.paragraph("No updates were sent from site today.", { size: 11 });
    return page.finish();
  }

  // Summary
  const summary = report.summary;
  if (summary) {
    page.paragraph(summary.overview, { size: 11 });
    page.bullets("Work done", summary.workDone);
    page.bullets("Problems and delays", summary.problems);
    page.bullets("Materials needed", summary.materialsNeeded);
    page.bullets("Next steps", summary.nextSteps);
  } else {
    page.paragraph("The summary couldn't be written today. Every update is listed below as it was sent.", { size: 11, color: MUTED });
  }

  // Locations
  const locations = locationsOf(report.updates);
  if (locations.length > 0) {
    page.heading("Locations shared");
    for (const u of locations) {
      page.ensure(56);
      page.paragraph(`${lagosTime(u.createdAt)}  ${u.memberName}`, { size: 10, font: BOLD, gap: 1 });
      page.paragraph(placeLabel(u.location), { size: 10, gap: 1 });
      page.link("Open in Google Maps", mapsLink(u.location), { size: 10 });
      page.paragraph(mapsLink(u.location), { size: 8, color: MUTED, gap: 8 });
    }
  }

  // Every update, as sent
  page.heading("All updates");
  for (const u of report.updates) {
    const what =
      u.kind === "location" && u.location ? placeLabel(u.location) : u.body?.trim() || (u.kind === "photo" ? "(no caption)" : "");
    page.paragraph(`${lagosTime(u.createdAt)}  ${u.memberName} (${KIND_LABEL[u.kind]}): ${what}`, { size: 9.5, gap: 4 });
  }

  // Photos
  if (photos.length > 0) {
    page.heading("Photos");
    drawPhotoGrid(page, photos);
    const left = photoUpdates.length - photos.length;
    if (left > 0) {
      page.paragraph(`${left} more ${left === 1 ? "photo was" : "photos were"} sent today but not shown here.`, { size: 9, color: MUTED });
    }
  }

  return page.finish();
}

function drawHeader(page: PageWriter, report: DailyReport, logo: Image | null) {
  const ctx = page.ctx;
  const top = page.y;
  let textX = MARGIN;
  let logoH = 0;
  if (logo) {
    const box = fitInside(logo.width, logo.height, 130, 64);
    ctx.drawImage(logo, MARGIN, top, box.w, box.h);
    textX = MARGIN + box.w + 16;
    logoH = box.h;
  }
  const textW = PAGE_W - MARGIN - textX;

  ctx.fillStyle = INK;
  ctx.font = `20px "${BOLD}"`;
  const nameLines = wrap(ctx, report.siteName, textW).slice(0, 2);
  let y = top + 20;
  for (const line of nameLines) {
    ctx.fillText(line, textX, y);
    y += 25;
  }
  ctx.fillStyle = MUTED;
  ctx.font = `11px "${REGULAR}"`;
  ctx.fillText(`Daily progress report · ${displayDate(report.date)}`, textX, y - 4);
  y += 6;

  page.y = Math.max(y, top + logoH) + 10;
  ctx.fillStyle = GREEN;
  ctx.fillRect(MARGIN, page.y, CONTENT_W, 2);
  page.y += 18;

  if (report.updates.length > 0) page.paragraph(reportCounts(report.updates), { size: 10, color: MUTED, gap: 12 });
}

function drawPhotoGrid(page: PageWriter, photos: Array<{ update: SiteUpdate; image: Image }>) {
  const gap = 15;
  const cellW = (CONTENT_W - gap) / 2;
  const imageH = 185;
  const captionSize = 8.5;
  const captionLine = 12;

  for (let i = 0; i < photos.length; i += 2) {
    const row = photos.slice(i, i + 2);
    const ctx = page.ctx;
    ctx.font = `${captionSize}px "${REGULAR}"`;
    const captions = row.map(({ update }) => {
      const text = `${lagosTime(update.createdAt)}  ${update.memberName}${update.body ? `: ${update.body.trim()}` : ""}`;
      const lines = wrap(ctx, text, cellW);
      return lines.length > 3 ? [...lines.slice(0, 2), `${lines[2]!.replace(/.{0,2}$/, "")}…`] : lines;
    });
    const rowH = imageH + 6 + Math.max(...captions.map((c) => c.length)) * captionLine + 14;
    page.ensure(rowH);

    row.forEach(({ image }, col) => {
      const x = MARGIN + col * (cellW + gap);
      const c = page.ctx;
      c.fillStyle = PHOTO_BG;
      c.fillRect(x, page.y, cellW, imageH);
      const box = fitInside(image.width, image.height, cellW, imageH);
      c.drawImage(image, x + (cellW - box.w) / 2, page.y + (imageH - box.h) / 2, box.w, box.h);
      c.fillStyle = MUTED;
      c.font = `${captionSize}px "${REGULAR}"`;
      captions[col]!.forEach((line, n) => c.fillText(line, x, page.y + imageH + 6 + captionSize + n * captionLine));
    });
    page.y += rowH;
  }
}

/** Keeps track of where the next line goes, and starts a new page when one fills up. */
class PageWriter {
  ctx!: SKRSContext2D;
  y = MARGIN;
  private pageNo = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly runningTitle: string,
  ) {
    this.newPage();
  }

  newPage() {
    if (this.pageNo > 0) this.doc.endPage();
    this.ctx = this.doc.beginPage(PAGE_W, PAGE_H) as unknown as SKRSContext2D;
    this.pageNo += 1;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    this.ctx.fillStyle = MUTED;
    this.ctx.font = `8px "${REGULAR}"`;
    this.ctx.textAlign = "left";
    this.ctx.fillText(this.runningTitle, MARGIN, PAGE_H - MARGIN / 2 - 4);
    this.ctx.textAlign = "right";
    this.ctx.fillText(`Page ${this.pageNo} · yarnOga Site Reporter`, PAGE_W - MARGIN, PAGE_H - MARGIN / 2 - 4);
    this.ctx.textAlign = "left";
    this.y = MARGIN;
  }

  /** Starts a new page unless `height` more points fit on this one. */
  ensure(height: number) {
    if (this.y + height > PAGE_H - MARGIN - FOOTER_H) this.newPage();
  }

  paragraph(text: string, opts: { size: number; font?: string; color?: string; gap?: number; indent?: number }) {
    const lineH = opts.size * 1.45;
    const indent = opts.indent ?? 0;
    this.ctx.font = `${opts.size}px "${opts.font ?? REGULAR}"`;
    for (const line of wrap(this.ctx, text, CONTENT_W - indent)) {
      this.ensure(lineH);
      this.ctx.font = `${opts.size}px "${opts.font ?? REGULAR}"`;
      this.ctx.fillStyle = opts.color ?? INK;
      this.ctx.fillText(line, MARGIN + indent, this.y + opts.size);
      this.y += lineH;
    }
    this.y += opts.gap ?? 8;
  }

  heading(text: string) {
    this.y += 6;
    this.ensure(48); // keep a heading with at least a line or two under it
    this.ctx.font = `13px "${BOLD}"`;
    this.ctx.fillStyle = GREEN;
    this.ctx.fillText(text, MARGIN, this.y + 13);
    this.y += 20;
    this.ctx.fillStyle = RULE;
    this.ctx.fillRect(MARGIN, this.y, CONTENT_W, 0.75);
    this.y += 8;
  }

  bullets(title: string, items: string[]) {
    if (items.length === 0) return;
    this.heading(title);
    for (const item of items) {
      this.ensure(16);
      this.ctx.fillStyle = GREEN;
      this.ctx.font = `10.5px "${BOLD}"`;
      this.ctx.fillText("•", MARGIN + 2, this.y + 10.5);
      this.paragraph(item, { size: 10.5, indent: 14, gap: 3 });
    }
    this.y += 4;
  }

  /** A line of text that opens a web address when tapped. */
  link(text: string, url: string, opts: { size: number }) {
    const lineH = opts.size * 1.45;
    this.ensure(lineH);
    this.ctx.font = `${opts.size}px "${BOLD}"`;
    this.ctx.fillStyle = GREEN;
    const baseline = this.y + opts.size;
    this.ctx.fillText(text, MARGIN, baseline);
    const width = this.ctx.measureText(text).width;
    this.ctx.fillRect(MARGIN, baseline + 2, width, 0.6);
    this.ctx.annotateLinkUrl(MARGIN, this.y, MARGIN + width, this.y + lineH, url);
    this.y += lineH + 1;
  }

  finish(): Uint8Array {
    this.doc.endPage();
    return new Uint8Array(this.doc.close());
  }
}

/** Splits text into lines that fit `maxWidth` at the context's current font. */
function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the line (e.g. a long link) is cut into pieces.
      let rest = word;
      while (ctx.measureText(rest).width > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

function fitInside(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { w: w * scale, h: h * scale };
}

/**
 * Loads a picture, shrinking it so its longest side is at most `maxSide`
 * pixels: phone photos are far bigger than a PDF page needs. Returns null for
 * a file that isn't a picture we can read.
 */
async function loadPicture(bytes: Uint8Array, maxSide: number): Promise<Image | null> {
  try {
    const image = await loadImage(Buffer.from(bytes));
    const scale = maxSide / Math.max(image.width, image.height);
    if (scale >= 1) return image;
    const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // logos with see-through backgrounds sit on white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await loadImage(await canvas.encode("jpeg", 82));
  } catch {
    return null;
  }
}

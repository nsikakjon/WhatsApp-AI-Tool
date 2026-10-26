import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { formatNaira } from "../core/money.js";
import { A4, jpegsToPdf } from "../core/pdf.js";
import { showWaId } from "../core/whatsapp/ids.js";
import type { ExportRow } from "./store.js";

// Orders and sales out of the app, three ways:
//   CSV           opens in Excel, Google Sheets or Numbers
//   Google Sheets a private link the sheet reads itself with =IMPORTDATA(...),
//                 so the sheet stays up to date without downloading anything
//   PDF           a printable sales report for a month
// Amounts are worked out from kobo with whole numbers; naira only appears
// when written out.

const HEADINGS = ["Order", "Status", "Date", "Confirmed", "Paid", "Customer", "WhatsApp", "Items", "Total (NGN)"];

/** Kobo as a plain naira amount for spreadsheets: 1250050 -> "12500.50". */
export function koboToPlainNaira(kobo: number): string {
  return `${Math.floor(kobo / 100)}.${String(kobo % 100).padStart(2, "0")}`;
}

/** Lagos date and time as a spreadsheet reads it: 2026-10-26 14:05. */
export function lagosDateTime(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}`;
}

/**
 * One CSV cell. Text starting with = + - @ is made plain text, so a customer
 * name like "=HYPERLINK(...)" can't run as a formula in the owner's sheet.
 */
export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function ordersCsv(rows: ExportRow[]): string {
  const lines = [HEADINGS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.ref,
        r.status,
        lagosDateTime(r.createdAt),
        lagosDateTime(r.confirmedAt),
        lagosDateTime(r.paidAt),
        r.customerName ?? "",
        showWaId(r.customerWaId),
        r.items,
        koboToPlainNaira(r.totalKobo),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // A byte-order mark first, so Excel shows ₦ and accents correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export interface ReportTotals {
  quotes: number;
  orders: number;
  paid: number;
  paidKobo: number;
  awaitingKobo: number;
}

export function reportTotals(rows: ExportRow[]): ReportTotals {
  const t = { quotes: rows.length, orders: 0, paid: 0, paidKobo: 0, awaitingKobo: 0 };
  for (const r of rows) {
    if (r.status === "confirmed" || r.status === "paid") t.orders += 1;
    if (r.status === "paid") {
      t.paid += 1;
      t.paidKobo += r.totalKobo;
    }
    if (r.status === "confirmed") t.awaitingKobo += r.totalKobo;
  }
  return t;
}

const fontDir = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  GlobalFonts.registerFromPath(`${fontDir}Inter-Regular.otf`, "Inter");
  GlobalFonts.registerFromPath(`${fontDir}Inter-SemiBold.otf`, "Inter SemiBold");
  GlobalFonts.registerFromPath(`${fontDir}Inter-ExtraBold.otf`, "Inter ExtraBold");
  fontsLoaded = true;
}

// A4 portrait at 150 dots per inch.
const W = 1240;
const H = 1754;
const M = 80;
const ROW = 46;

/** A printable sales report: totals, then every order (only confirmed and paid ones). */
export function salesReportPdf(input: { businessName: string; period: string; rows: ExportRow[]; generatedAt: Date }): Uint8Array {
  loadFonts();
  const totals = reportTotals(input.rows);
  const orders = input.rows.filter((r) => r.status === "confirmed" || r.status === "paid");
  const pages: Uint8Array[] = [];
  let index = 0;
  let pageNo = 0;
  do {
    pageNo += 1;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "top";
    let y = M;
    ctx.fillStyle = "#111827";
    ctx.font = "44px Inter ExtraBold";
    ctx.fillText(clip(ctx, input.businessName, W - 2 * M), M, y);
    y += 62;
    ctx.font = "30px Inter";
    ctx.fillStyle = "#4b5563";
    ctx.fillText(`Sales report · ${input.period}`, M, y);
    y += 70;

    if (pageNo === 1) {
      const boxes: Array<[string, string]> = [
        ["Quotes sent", String(totals.quotes)],
        ["Orders", String(totals.orders)],
        ["Paid in", formatNaira(totals.paidKobo)],
        ["Awaiting payment", formatNaira(totals.awaitingKobo)],
      ];
      const bw = (W - 2 * M - 3 * 20) / 4;
      boxes.forEach(([label, value], i) => {
        const x = M + i * (bw + 20);
        ctx.fillStyle = "#f3f4f6";
        ctx.fillRect(x, y, bw, 130);
        ctx.fillStyle = "#6b7280";
        ctx.font = "22px Inter SemiBold";
        ctx.fillText(label.toUpperCase(), x + 20, y + 22);
        ctx.fillStyle = "#111827";
        ctx.font = "36px Inter ExtraBold";
        ctx.fillText(clip(ctx, value, bw - 40), x + 20, y + 62);
      });
      y += 180;
    }

    const cols = { ref: M, date: M + 170, customer: M + 380, items: M + 650, total: W - M };
    ctx.fillStyle = "#111827";
    ctx.font = "24px Inter SemiBold";
    ctx.fillText("Order", cols.ref, y);
    ctx.fillText("Date", cols.date, y);
    ctx.fillText("Customer", cols.customer, y);
    ctx.fillText("Items", cols.items, y);
    ctx.textAlign = "right";
    ctx.fillText("Total", cols.total, y);
    ctx.textAlign = "left";
    y += 40;
    ctx.fillRect(M, y, W - 2 * M, 2);
    y += 14;

    ctx.font = "24px Inter";
    while (index < orders.length && y + ROW < H - M - 40) {
      const r = orders[index]!;
      ctx.fillStyle = "#111827";
      ctx.fillText(r.ref, cols.ref, y);
      ctx.fillText(lagosDateTime(r.confirmedAt ?? r.createdAt).slice(0, 10), cols.date, y);
      ctx.fillText(clip(ctx, r.customerName ?? showWaId(r.customerWaId), 250), cols.customer, y);
      ctx.fillStyle = "#4b5563";
      ctx.fillText(clip(ctx, r.items, cols.total - cols.items - 190), cols.items, y);
      ctx.textAlign = "right";
      ctx.fillStyle = r.status === "paid" ? "#15803d" : "#111827";
      ctx.fillText(`${formatNaira(r.totalKobo)}${r.status === "paid" ? "" : " *"}`, cols.total, y);
      ctx.textAlign = "left";
      y += ROW;
      index += 1;
    }
    if (!orders.length) {
      ctx.fillStyle = "#6b7280";
      ctx.fillText("No orders in this period.", M, y);
    }

    ctx.fillStyle = "#9ca3af";
    ctx.font = "20px Inter";
    ctx.fillText(
      `* not paid yet · Made ${lagosDateTime(input.generatedAt)} (Lagos time) with yarnOga · Page ${pageNo}`,
      M,
      H - M,
    );
    pages.push(canvas.toBuffer("image/jpeg", 88));
  } while (index < orders.length);

  return jpegsToPdf(pages.map((jpeg) => ({ jpeg, widthPx: W, heightPx: H, widthPt: A4.portrait.w, heightPt: A4.portrait.h })));
}

function clip(ctx: SKRSContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t}…`;
}

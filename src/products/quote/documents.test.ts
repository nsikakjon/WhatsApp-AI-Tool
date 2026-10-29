import { createCanvas, loadImage } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { formatDocDate, renderDocument, type DocumentInput } from "./documents.js";

const base: DocumentInput = {
  kind: "invoice",
  businessName: "KahnPrints",
  ref: "KP-1001",
  date: new Date("2026-10-14T23:30:00Z"),
  customerName: "Ada",
  customerWaId: "2348012345678",
  lines: [{ variantId: "v", name: "Flyers: A5, double-sided", quantity: 100, unitPriceKobo: 15_000, totalKobo: 1_500_000 }],
  totalKobo: 1_500_000,
  paymentDetails: "Bank 0000000000\nExample Ltd",
};

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

describe("invoices and receipts", () => {
  it("draws an invoice and a receipt as JPEG pictures", async () => {
    const logo = createCanvas(200, 100);
    logo.getContext("2d").fillRect(0, 0, 200, 100);
    expect(isJpeg(await renderDocument({ ...base, logo: logo.toBuffer("image/png") }))).toBe(true);
    expect(isJpeg(await renderDocument({ ...base, kind: "receipt" }))).toBe(true);
  });

  it("draws a discount code as its own line", async () => {
    const discount = { code: "XMAS", amountKobo: 300_000 };
    expect(isJpeg(await renderDocument({ ...base, discount, totalKobo: 1_200_000 }))).toBe(true);
  });

  it("draws a delivery fee as its own line", async () => {
    const delivery = { label: "Delivery (Ikeja)", feeKobo: 200_000 };
    expect(isJpeg(await renderDocument({ ...base, delivery, totalKobo: 1_700_000 }))).toBe(true);
  });

  it("puts a QR code that phones can read on walk-in receipts", async () => {
    const qrText = "https://bot.example.com/pickup/00000000-0000-0000-0000-000000000002.00000000-0000-0000-0000-00000000a001.abcdefghijklmnopqrstuvwx";
    const jpeg = await renderDocument({ ...base, kind: "receipt", pickup: { qrText, code: "KP-1001 · 4827", table: "Table 7", stations: ["Bar", "Kitchen"] } });
    const image = await loadImage(jpeg);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height);
    expect(jsQR(new Uint8ClampedArray(pixels.data), image.width, image.height)?.data).toBe(qrText);
  });

  it("still draws when the logo file is broken", async () => {
    expect(isJpeg(await renderDocument({ ...base, logo: new Uint8Array([1, 2, 3]) }))).toBe(true);
  });

  it("dates documents in Lagos time", () => {
    // 23:30 UTC on the 14th is already 00:30 on the 15th in Lagos.
    expect(formatDocDate(new Date("2026-10-14T23:30:00Z"))).toBe("15 Oct 2026");
  });
});

import { describe, expect, it } from "vitest";
import { A4, jpegsToPdf } from "./pdf.js";

describe("jpegsToPdf", () => {
  it("puts one picture on each page with a correct cross-reference table", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = jpegsToPdf([
      { jpeg, widthPx: 10, heightPx: 20, widthPt: A4.portrait.w, heightPt: A4.portrait.h },
      { jpeg, widthPx: 20, heightPx: 10, widthPt: A4.landscape.w, heightPt: A4.landscape.h },
    ]);
    const text = new TextDecoder("latin1").decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/MediaBox [0 0 841.89 595.28]");
    // Every object offset in the table points at "n 0 obj".
    const xref = Number(text.match(/startxref\n(\d+)/)![1]);
    const rows = text.slice(xref).split("\n").slice(3).filter((l) => / n $/.test(l));
    rows.forEach((row, i) => expect(text.slice(Number(row.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});

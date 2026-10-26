// Makes a PDF from JPEG pictures, one picture per page. We draw pages
// (posters, sales reports) with the same canvas code as invoices and flyers,
// so the PDF looks exactly like the picture, naira signs and all, without a
// PDF library.

export interface PdfPage {
  jpeg: Uint8Array;
  /** The picture's size in pixels. */
  widthPx: number;
  heightPx: number;
  /** The printed page size in points (1/72 inch), e.g. A4 portrait 595 x 842. */
  widthPt: number;
  heightPt: number;
}

export const A4 = { portrait: { w: 595.28, h: 841.89 }, landscape: { w: 841.89, h: 595.28 } };

export function jpegsToPdf(pages: PdfPage[]): Uint8Array {
  if (!pages.length) throw new Error("jpegsToPdf: no pages");
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const enc = new TextEncoder();
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string | Array<string | Uint8Array>) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const p of Array.isArray(body) ? body : [body]) push(p);
    push("\nendobj\n");
  };

  // Objects: 1 catalog, 2 page list, then per page: page, picture, drawing.
  const pageIds = pages.map((_, i) => 3 + i * 3);
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const pageId = pageIds[i]!;
    const w = p.widthPt.toFixed(2);
    const h = p.heightPt.toFixed(2);
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>`,
    );
    object(pageId + 1, [
      `<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      "\nendstream",
    ]);
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(pageId + 2, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

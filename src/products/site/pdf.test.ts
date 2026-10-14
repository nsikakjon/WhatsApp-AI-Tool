import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { renderReportPdf } from "./pdf.js";
import { buildReport, formatReport } from "./report.js";
import type { SiteUpdate } from "./store.js";

const at = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00+01:00`);

async function picture(w: number, h: number): Promise<Uint8Array> {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#c9a36b";
  ctx.fillRect(0, 0, w, h);
  return new Uint8Array(await canvas.encode("jpeg"));
}

const updates: SiteUpdate[] = [
  { memberName: "Tunde", kind: "text", body: "Blockwork on first floor started", createdAt: at("08:10") },
  { memberName: "Tunde", kind: "photo", body: "Columns", photoPath: "s1/a.jpg", createdAt: at("09:00") },
  {
    memberName: "Ngozi",
    kind: "location",
    body: null,
    location: { latitude: 6.4474, longitude: 3.4723, name: "Lekki Phase 1", address: "Admiralty Way, Lagos" },
    createdAt: at("10:30"),
  },
];

const summary = {
  overview: "Blockwork started on the first floor.",
  workDone: ["Blockwork on first floor started"],
  problems: [],
  materialsNeeded: [],
  nextSteps: [],
};

describe("PDF report", () => {
  it("draws a PDF with the logo, photos and locations", async () => {
    const report = { siteName: "Lekki Block B", date: "2026-10-14", updates, summary, text: "" };
    const pdf = await renderReportPdf({
      report,
      logo: await picture(400, 200),
      photos: new Map([["s1/a.jpg", await picture(1600, 1200)]]),
    });
    const head = Buffer.from(pdf.slice(0, 5)).toString();
    expect(head).toBe("%PDF-");
    // The Google Maps link is tappable.
    expect(Buffer.from(pdf).toString("latin1")).toContain("maps.google.com/?q=6.44740,3.47230");
  });

  it("starts new pages for a long day", async () => {
    const many: SiteUpdate[] = Array.from({ length: 120 }, (_, i) => ({
      memberName: "Tunde",
      kind: "text",
      body: `Update number ${i} with a fairly long description of what happened on site today`,
      createdAt: at("12:00"),
    }));
    const report = await buildReport({ summarise: async () => summary }, "Lekki Block B", "2026-10-14", many);
    const pdf = await renderReportPdf({ report, logo: null, photos: new Map() });
    const pages = Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });

  it("still draws a PDF for a day with no updates, or a broken photo", async () => {
    const empty = { siteName: "Lekki Block B", date: "2026-10-14", updates: [], summary: null, text: "" };
    expect((await renderReportPdf({ report: empty, logo: new Uint8Array([1, 2, 3]), photos: new Map() })).length).toBeGreaterThan(0);
    const broken = { siteName: "Lekki Block B", date: "2026-10-14", updates, summary: null, text: "" };
    const pdf = await renderReportPdf({ report: broken, logo: null, photos: new Map([["s1/a.jpg", new Uint8Array([9])]]) });
    expect(pdf.length).toBeGreaterThan(0);
  });
});

describe("locations in the text report", () => {
  it("lists each pin with a Google Maps link and counts them", () => {
    const text = formatReport("Lekki Block B", "2026-10-14", updates, summary);
    expect(text).toContain("3 updates from 2 people, 1 photo, 1 location");
    expect(text).toContain("*Locations shared*\n• 10:30 Ngozi: Lekki Phase 1, Admiralty Way, Lagos\n  https://maps.google.com/?q=6.44740,3.47230");
  });
});

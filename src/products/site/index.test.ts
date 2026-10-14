import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { createSiteReporter } from "./index.js";
import type { ReportPdfInput } from "./pdf.js";
import { formatReport, lagosDate, lagosDayBounds, lagosHour } from "./report.js";
import type { Member, SiteStore, SiteUpdate, UpdateKind } from "./store.js";
import type { Summariser, Summary } from "./summarise.js";

const silent = { info() {}, error() {} };

const members: Record<string, Member> = {
  "2348011111111": { id: "m1", name: "Tunde", role: "staff", siteId: "s1", siteName: "Lekki Block B" },
  "2348022222222": { id: "m2", name: "Ngozi", role: "manager", siteId: "s1", siteName: "Lekki Block B" },
};

function memoryStore() {
  const updates: Array<{
    siteId: string;
    memberId: string;
    waMessageId: string;
    kind: UpdateKind;
    body: string | null;
    photoPath: string | null;
    location?: SiteUpdate["location"];
    createdAt: Date;
  }> = [];
  const reports = new Map<string, string>();
  const photos: string[] = [];
  const logos = new Map<string, Uint8Array>();
  const store: SiteStore = {
    async findMember(waId) {
      return members[waId] ?? null;
    },
    async lastUpdate(memberId) {
      const last = updates.filter((u) => u.memberId === memberId).at(-1);
      return last ? { kind: last.kind, createdAt: last.createdAt } : null;
    },
    async savePhoto(siteId, waMessageId) {
      if (waMessageId === "broken") throw new Error("storage down");
      const path = `${siteId}/${waMessageId}.jpg`;
      photos.push(path);
      return path;
    },
    async photo(path) {
      if (!photos.includes(path)) throw new Error("not found");
      return new Uint8Array([1]);
    },
    async saveLogo(siteId, image) {
      logos.set(siteId, new Uint8Array(await image.data.arrayBuffer()));
    },
    async logo(siteId) {
      return logos.get(siteId) ?? null;
    },
    async addUpdate(u) {
      if (updates.some((x) => x.waMessageId === u.waMessageId)) return "duplicate";
      updates.push({ ...u, createdAt: new Date() });
      return "new";
    },
    async updatesBetween(siteId, from, to) {
      return updates
        .filter((u) => u.siteId === siteId && u.createdAt >= from && u.createdAt < to)
        .map((u) => ({
          memberName: Object.values(members).find((m) => m.id === u.memberId)!.name,
          kind: u.kind,
          body: u.body,
          photoPath: u.photoPath,
          location: u.location ?? null,
          createdAt: u.createdAt,
        }));
    },
    async sitesWithManagers() {
      return [{ siteId: "s1", siteName: "Lekki Block B", managers: ["2348022222222"] }];
    },
    async hasReport(siteId, date) {
      return reports.has(`${siteId}:${date}`);
    },
    async claimReport(siteId, date, body) {
      if (reports.has(`${siteId}:${date}`)) return false;
      reports.set(`${siteId}:${date}`, body);
      return true;
    },
  };
  return { store, updates, reports, photos, logos };
}

const summary: Summary = {
  overview: "Good progress on the slab.",
  workDone: ["Ground floor slab cast"],
  problems: [],
  materialsNeeded: ["20 bags of cement"],
  nextSteps: [],
};

function fakeAi(fail = false) {
  const calls: unknown[] = [];
  const ai: Summariser = {
    async summarise(input) {
      calls.push(input);
      if (fail) throw new Error("AI down");
      return summary;
    },
  };
  return { ai, calls };
}

function setup(opts: { failAi?: boolean; failPdf?: boolean } = {}) {
  const mem = memoryStore();
  const { ai, calls } = fakeAi(opts.failAi);
  const pdfInputs: ReportPdfInput[] = [];
  const renderPdf = async (input: ReportPdfInput) => {
    pdfInputs.push(input);
    if (opts.failPdf) throw new Error("drawing failed");
    return new Uint8Array([37, 80, 68, 70]);
  };
  const reporter = createSiteReporter({ store: mem.store, ai, reportHour: 18, renderPdf, log: silent });
  return { reporter, aiCalls: calls, pdfInputs, ...mem };
}

let n = 0;
function msg(from: string, fields: Partial<IncomingMessage>): IncomingMessage {
  return { waMessageId: `wamid.${++n}`, from, type: "text", timestamp: 0, raw: {}, ...fields };
}
const ctx = {
  contactId: "c1",
  history: [],
  downloadMedia: async () => ({ data: new Blob(["jpg"]), mimeType: "image/jpeg" }),
  sendLater: async () => {},
};

describe("site reporter: logging updates", () => {
  it("turns away numbers that aren't on a site team", async () => {
    const { reporter, updates } = setup();
    const reply = await reporter.handle(msg("2348099999999", { text: "hello" }), ctx);
    expect(reply?.text).toContain("isn't registered");
    expect(updates).toHaveLength(0);
  });

  it("logs a text update against the sender's site", async () => {
    const { reporter, updates } = setup();
    const reply = await reporter.handle(msg("2348011111111", { text: "Slab casting finished" }), ctx);
    expect(reply?.text).toBe("Logged for Lekki Block B ✅");
    expect(updates[0]).toMatchObject({ siteId: "s1", memberId: "m1", kind: "text", body: "Slab casting finished" });
  });

  it("logs a voice note's transcript and reads it back", async () => {
    const { reporter, updates } = setup();
    const reply = await reporter.handle(msg("2348011111111", { type: "audio", text: "We need cement", transcribed: true }), ctx);
    expect(reply?.text).toContain('I heard: "We need cement"');
    expect(updates[0]).toMatchObject({ kind: "voice", body: "We need cement" });
  });

  it("asks for text when a voice note couldn't be understood", async () => {
    const { reporter, updates } = setup();
    const reply = await reporter.handle(msg("2348011111111", { type: "audio", mediaId: "a1" }), ctx);
    expect(reply?.text).toContain("type the update");
    expect(updates).toHaveLength(0);
  });

  it("saves photos with their caption, and replies once to a batch", async () => {
    const { reporter, updates, photos } = setup();
    const first = await reporter.handle(msg("2348011111111", { type: "image", mediaId: "i1", caption: "Columns" }), ctx);
    const second = await reporter.handle(msg("2348011111111", { type: "image", mediaId: "i2" }), ctx);
    expect(first?.text).toBe("Photo logged for Lekki Block B ✅");
    expect(second).toBeNull();
    expect(photos).toHaveLength(2);
    expect(updates.map((u) => [u.kind, u.body])).toEqual([["photo", "Columns"], ["photo", null]]);
  });

  it("asks for a photo again when it can't be saved", async () => {
    const { reporter, updates } = setup();
    const reply = await reporter.handle(msg("2348011111111", { waMessageId: "broken", type: "image", mediaId: "i1" }), ctx);
    expect(reply?.text).toContain("send it again");
    expect(updates).toHaveLength(0);
  });

  it("logs a location pin with its place name", async () => {
    const { reporter, updates } = setup();
    const location = { latitude: 6.4474, longitude: 3.4723, name: "Lekki Phase 1", address: "Admiralty Way, Lagos" };
    const reply = await reporter.handle(msg("2348011111111", { type: "location", location }), ctx);
    expect(reply?.text).toBe("📍 Location logged for Lekki Block B ✅\nLekki Phase 1, Admiralty Way, Lagos");
    expect(updates[0]).toMatchObject({ kind: "location", body: null, location });
  });

  it("shows the coordinates when a pin has no place name", async () => {
    const { reporter } = setup();
    const reply = await reporter.handle(msg("2348011111111", { type: "location", location: { latitude: 6.5, longitude: 3.35 } }), ctx);
    expect(reply?.text).toContain("6.50000, 3.35000");
  });

  it("lets a manager set the logo with a picture captioned logo, without logging it", async () => {
    const { reporter, updates, logos } = setup();
    const staff = await reporter.handle(msg("2348011111111", { type: "image", mediaId: "l1", caption: "Logo" }), ctx);
    expect(staff?.text).toContain("Only site managers");
    const manager = await reporter.handle(msg("2348022222222", { type: "image", mediaId: "l2", caption: " Logo " }), ctx);
    expect(manager?.text).toContain("Logo saved");
    expect(logos.has("s1")).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it("doesn't log the same WhatsApp message twice", async () => {
    const { reporter, updates } = setup();
    const m = msg("2348011111111", { text: "Done" });
    await reporter.handle(m, ctx);
    expect(await reporter.handle(m, ctx)).toBeNull();
    expect(updates).toHaveLength(1);
  });
});

describe("site reporter: reports", () => {
  it("gives a manager today's report on request, but not staff", async () => {
    const { reporter } = setup();
    await reporter.handle(msg("2348011111111", { text: "Slab cast" }), ctx);
    const staff = await reporter.handle(msg("2348011111111", { text: "report" }), ctx);
    expect(staff?.text).toContain("Only site managers");
    const manager = await reporter.handle(msg("2348022222222", { text: " Report " }), ctx);
    expect(manager?.text).toContain("*Lekki Block B: progress report for");
    expect(manager?.text).toContain("• Ground floor slab cast");
    expect(manager?.documents?.[0]).toMatchObject({ mimeType: "application/pdf", filename: expect.stringMatching(/^Lekki Block B \d{4}-\d{2}-\d{2}\.pdf$/) });
  });

  it("puts the logo, photos and locations into the PDF", async () => {
    const { reporter, pdfInputs } = setup();
    await reporter.handle(msg("2348022222222", { type: "image", mediaId: "l1", caption: "logo" }), ctx);
    await reporter.handle(msg("2348011111111", { type: "image", mediaId: "i1", caption: "Columns" }), ctx);
    await reporter.handle(msg("2348011111111", { type: "location", location: { latitude: 6.4474, longitude: 3.4723 } }), ctx);
    const reply = await reporter.handle(msg("2348022222222", { text: "report" }), ctx);
    expect(reply?.text).toContain("*Locations shared*");
    expect(reply?.text).toContain("https://maps.google.com/?q=6.44740,3.47230");
    const input = pdfInputs[0]!;
    expect(input.logo).not.toBeNull();
    expect([...input.photos.keys()]).toHaveLength(1);
    expect(input.report.updates.map((u) => u.kind)).toEqual(["photo", "location"]);
  });

  it("still sends the text report when the PDF can't be made", async () => {
    const { reporter } = setup({ failPdf: true });
    await reporter.handle(msg("2348011111111", { text: "Slab cast" }), ctx);
    const reply = await reporter.handle(msg("2348022222222", { text: "report" }), ctx);
    expect(reply?.text).toContain("progress report for");
    expect(reply?.documents).toBeUndefined();
  });

  it("sends each site's daily report once, only after the report hour", async () => {
    const { reporter, reports } = setup();
    await reporter.handle(msg("2348011111111", { text: "Slab cast" }), ctx);
    const now = new Date();
    const day = lagosDate(now);
    const before = new Date(lagosDayBounds(day).from.getTime() + 17 * 3600_000);
    const after = new Date(lagosDayBounds(day).from.getTime() + 18 * 3600_000);
    expect(await reporter.dueReports(before)).toEqual([]);
    const due = await reporter.dueReports(after);
    expect(due).toHaveLength(1);
    expect(due[0]!.to).toBe("2348022222222");
    expect(due[0]!.pdf?.mimeType).toBe("application/pdf");
    expect(reports.size).toBe(1);
    expect(await reporter.dueReports(after)).toEqual([]);
  });

  it("still sends the raw updates when the AI fails", async () => {
    const { reporter } = setup({ failAi: true });
    await reporter.handle(msg("2348011111111", { text: "Slab cast" }), ctx);
    const reply = await reporter.handle(msg("2348022222222", { text: "report" }), ctx);
    expect(reply?.text).toContain("here are the updates as sent");
    expect(reply?.text).toContain("Tunde: Slab cast");
  });
});

describe("report formatting and Lagos time", () => {
  it("works out Lagos dates and hours (UTC+1)", () => {
    const lateUtc = new Date("2026-10-10T23:30:00Z");
    expect(lagosDate(lateUtc)).toBe("2026-10-11");
    expect(lagosHour(lateUtc)).toBe(0);
    expect(lagosDayBounds("2026-10-10").from.toISOString()).toBe("2026-10-09T23:00:00.000Z");
  });

  it("counts updates, people and photos in code", () => {
    const at = new Date("2026-10-10T09:00:00Z");
    const updates: SiteUpdate[] = [
      { memberName: "Tunde", kind: "text", body: "Slab cast", createdAt: at },
      { memberName: "Tunde", kind: "photo", body: null, createdAt: at },
      { memberName: "Ngozi", kind: "photo", body: "Columns", createdAt: at },
    ];
    const text = formatReport("Lekki Block B", "2026-10-10", updates, summary);
    expect(text).toContain("Sat 10 Oct 2026");
    expect(text).toContain("3 updates from 2 people, 2 photos");
    expect(text).toContain("*Materials needed*\n• 20 bags of cement");
    expect(text).not.toContain("Problems and delays");
  });

  it("says so when nobody sent anything", () => {
    expect(formatReport("Lekki Block B", "2026-10-10", [], null)).toContain("No updates were sent");
  });
});

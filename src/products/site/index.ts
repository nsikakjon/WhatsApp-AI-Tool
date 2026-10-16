import type { Product, Reply } from "../../core/product.js";
import type { OutgoingDocument } from "../../core/whatsapp/client.js";
import type { SharedLocation } from "../../core/whatsapp/types.js";
import { MAX_PDF_PHOTOS, renderReportPdf, type ReportPdfInput } from "./pdf.js";
import { buildReport, displayDate, lagosDate, lagosDayBounds, lagosHour, placeLabel, type DailyReport } from "./report.js";
import type { Member, SiteStore, UpdateKind } from "./store.js";
import type { Summariser } from "./summarise.js";

// Phase 2: the construction site progress reporter.
//
// 1. Site staff (registered in site_members) send updates on WhatsApp: text,
//    photos, voice notes or location pins. Each one is logged against their site.
// 2. Every evening the day's updates become a progress report that goes to
//    the site's managers, as a WhatsApp message plus a PDF with the photos and
//    locations. A manager can also send "report" to get it any time.
// 3. A manager sets the logo printed on the PDF by sending a picture with the
//    caption "logo".

export interface SiteReporterOptions {
  store: SiteStore;
  ai: Summariser;
  /** Lagos hour (0-23) when the daily report goes out. */
  reportHour: number;
  /** Draws the PDF report. Tests can swap it out. */
  renderPdf?: (input: ReportPdfInput) => Promise<Uint8Array>;
  log?: Pick<Console, "info" | "error">;
}

export interface DueReport {
  to: string;
  text: string;
  /** The same report as a PDF, or undefined if it couldn't be made. */
  pdf?: OutgoingDocument;
}

export interface SiteReporter extends Product {
  /**
   * Daily reports that are due and haven't been sent yet. Each is recorded
   * before it's returned, so calling this again never repeats one.
   */
  dueReports(now: Date): Promise<DueReport[]>;
}

// Photos sent within this time of the sender's last photo get no reply, so a
// batch of ten photos gets one "logged" message, not ten.
const PHOTO_BATCH_MS = 2 * 60 * 1000;

const HELP =
  "Send your site updates here: a message, photos, a voice note or a location pin (📎 > Location). Each one is logged for the daily progress report.";

const MANAGER_HELP =
  ' Send "report" to get today\'s progress report so far (with a PDF). To put your logo on the PDF, send it as a picture with the caption "logo".';

export function createSiteReporter(opts: SiteReporterOptions): SiteReporter {
  const log = opts.log ?? console;
  const renderPdf = opts.renderPdf ?? renderReportPdf;

  async function reportFor(siteId: string, siteName: string, date: string): Promise<DailyReport> {
    const { from, to } = lagosDayBounds(date);
    const updates = await opts.store.updatesBetween(siteId, from, to);
    return buildReport(opts.ai, siteName, date, updates, log);
  }

  /** The report as a PDF file, or undefined if it couldn't be made (the text still goes out). */
  async function pdfFor(siteId: string, report: DailyReport): Promise<OutgoingDocument | undefined> {
    try {
      const logo = await opts.store.logo(siteId).catch((err) => {
        log.error(`Could not load the logo for ${report.siteName}:`, err);
        return null;
      });
      const photos = new Map<string, Uint8Array>();
      const paths = report.updates.flatMap((u) => (u.kind === "photo" && u.photoPath ? [u.photoPath] : []));
      for (const path of paths.slice(0, MAX_PDF_PHOTOS)) {
        try {
          photos.set(path, await opts.store.photo(path));
        } catch (err) {
          log.error(`Could not load site photo ${path} for the PDF:`, err);
        }
      }
      const data = await renderPdf({ report, logo, photos });
      return {
        data,
        mimeType: "application/pdf",
        filename: `${report.siteName} ${report.date}.pdf`.replace(/[\\/:*?"<>|]/g, "-"),
        caption: `${report.siteName}: progress report for ${displayDate(report.date)}`,
      };
    } catch (err) {
      log.error(`PDF report failed for ${report.siteName}:`, err);
      return undefined;
    }
  }

  async function logUpdate(
    member: Member,
    waMessageId: string,
    kind: UpdateKind,
    body: string | null,
    photoPath: string | null,
    location: SharedLocation | null = null,
  ) {
    return opts.store.addUpdate({ siteId: member.siteId, memberId: member.id, waMessageId, kind, body, photoPath, location });
  }

  return {
    name: "site",

    async handle(msg, ctx): Promise<Reply | null> {
      const member = await opts.store.findMember(msg.from);
      if (!member) {
        return {
          text: "Hello! This number is for construction site progress updates, and your number isn't registered yet. Please ask your site manager to add you.",
        };
      }

      const command = msg.type === "text" ? msg.text?.trim().toLowerCase() : undefined;
      if (command === "help" || command === "hi" || command === "hello") {
        return { text: `Hi ${member.name}! ${HELP}${member.role === "manager" ? MANAGER_HELP : ""}` };
      }
      if (command === "report") {
        if (member.role !== "manager") return { text: "Only site managers can request the report. Your updates are still being logged." };
        const report = await reportFor(member.siteId, member.siteName, lagosDate(new Date()));
        const pdf = await pdfFor(member.siteId, report);
        return { text: report.text, documents: pdf ? [pdf] : undefined };
      }

      if (msg.type === "image" && msg.mediaId && msg.caption?.trim().toLowerCase() === "logo") {
        if (member.role !== "manager") return { text: "Only site managers can change the logo on the report." };
        try {
          await opts.store.saveLogo(member.siteId, await ctx.downloadMedia(msg.mediaId));
        } catch (err) {
          log.error(`Could not save the logo for ${member.siteName}:`, err);
          return { text: "Sorry, I couldn't save that logo. Please send it again." };
        }
        return { text: `Logo saved ✅ It will appear at the top of ${member.siteName}'s PDF reports.` };
      }

      if (msg.type === "location") {
        if (!msg.location) return { text: "Sorry, I couldn't read that location. Please send it again." };
        const label = placeLabel(msg.location);
        if ((await logUpdate(member, msg.waMessageId, "location", null, null, msg.location)) === "duplicate") return null;
        return { text: `📍 Location logged for ${member.siteName} ✅\n${label}` };
      }

      if (msg.type === "image" && msg.mediaId) {
        const previous = await opts.store.lastUpdate(member.id);
        let photoPath: string;
        try {
          photoPath = await opts.store.savePhoto(member.siteId, msg.waMessageId, await ctx.downloadMedia(msg.mediaId));
        } catch (err) {
          log.error(`Could not save site photo ${msg.waMessageId}:`, err);
          return { text: "Sorry, I couldn't save that photo. Please send it again." };
        }
        if ((await logUpdate(member, msg.waMessageId, "photo", msg.caption ?? null, photoPath)) === "duplicate") return null;
        const inBatch = previous?.kind === "photo" && Date.now() - previous.createdAt.getTime() < PHOTO_BATCH_MS;
        return inBatch && !msg.caption ? null : { text: `Photo logged for ${member.siteName} ✅` };
      }

      if (msg.type === "audio") {
        if (!msg.text) return { text: "Sorry, I couldn't make out that voice note. Could you type the update instead?" };
        if ((await logUpdate(member, msg.waMessageId, "voice", msg.text, null)) === "duplicate") return null;
        return { text: `Logged for ${member.siteName} ✅\nI heard: "${msg.text}"` };
      }

      if (msg.type === "text" && msg.text) {
        if ((await logUpdate(member, msg.waMessageId, "text", msg.text, null)) === "duplicate") return null;
        return { text: `Logged for ${member.siteName} ✅` };
      }

      return { text: `I can log messages, photos, voice notes and location pins. ${HELP}` };
    },

    async dueReports(now) {
      if (lagosHour(now) < opts.reportHour) return [];
      const date = lagosDate(now);
      const out: DueReport[] = [];

      for (const site of await opts.store.sitesWithManagers()) {
        try {
          if (await opts.store.hasReport(site.siteId, date)) continue;
          const report = await reportFor(site.siteId, site.siteName, date);
          if (!(await opts.store.claimReport(site.siteId, date, report.text))) continue;
          const pdf = await pdfFor(site.siteId, report);
          log.info(`Daily report ready for ${site.siteName} (${site.managers.length} manager(s), PDF: ${pdf ? "yes" : "no"})`);
          for (const to of site.managers) out.push({ to, text: report.text, pdf });
        } catch (err) {
          log.error(`Daily report failed for ${site.siteName}:`, err);
        }
      }
      return out;
    },
  };
}

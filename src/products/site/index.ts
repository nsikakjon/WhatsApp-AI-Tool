import type { Product, Reply } from "../../core/product.js";
import { buildReport, lagosDate, lagosDayBounds, lagosHour } from "./report.js";
import type { Member, SiteStore, UpdateKind } from "./store.js";
import type { Summariser } from "./summarise.js";

// Phase 2: the construction site progress reporter.
//
// 1. Site staff (registered in site_members) send updates on WhatsApp: text,
//    photos or voice notes. Each one is logged against their site.
// 2. Every evening the day's updates become a progress report that goes to
//    the site's managers. A manager can also send "report" to get it any time.

export interface SiteReporterOptions {
  store: SiteStore;
  ai: Summariser;
  /** Lagos hour (0-23) when the daily report goes out. */
  reportHour: number;
  log?: Pick<Console, "info" | "error">;
}

export interface SiteReporter extends Product {
  /**
   * Daily reports that are due and haven't been sent yet. Each is recorded
   * before it's returned, so calling this again never repeats one.
   */
  dueReports(now: Date): Promise<Array<{ to: string; text: string }>>;
}

// Photos sent within this time of the sender's last photo get no reply, so a
// batch of ten photos gets one "logged" message, not ten.
const PHOTO_BATCH_MS = 2 * 60 * 1000;

const HELP =
  "Send your site updates here: a message, photos or a voice note. Each one is logged for the daily progress report.";

export function createSiteReporter(opts: SiteReporterOptions): SiteReporter {
  const log = opts.log ?? console;

  async function reportFor(siteId: string, siteName: string, date: string): Promise<string> {
    const { from, to } = lagosDayBounds(date);
    const updates = await opts.store.updatesBetween(siteId, from, to);
    return buildReport(opts.ai, siteName, date, updates, log);
  }

  async function logUpdate(member: Member, waMessageId: string, kind: UpdateKind, body: string | null, photoPath: string | null) {
    return opts.store.addUpdate({ siteId: member.siteId, memberId: member.id, waMessageId, kind, body, photoPath });
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
        return { text: `Hi ${member.name}! ${HELP}${member.role === "manager" ? ' Send "report" to get today\'s progress report so far.' : ""}` };
      }
      if (command === "report") {
        if (member.role !== "manager") return { text: "Only site managers can request the report. Your updates are still being logged." };
        return { text: await reportFor(member.siteId, member.siteName, lagosDate(new Date())) };
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

      return { text: `I can log messages, photos and voice notes. ${HELP}` };
    },

    async dueReports(now) {
      if (lagosHour(now) < opts.reportHour) return [];
      const date = lagosDate(now);
      const out: Array<{ to: string; text: string }> = [];

      for (const site of await opts.store.sitesWithManagers()) {
        try {
          if (await opts.store.hasReport(site.siteId, date)) continue;
          const text = await reportFor(site.siteId, site.siteName, date);
          if (!(await opts.store.claimReport(site.siteId, date, text))) continue;
          log.info(`Daily report ready for ${site.siteName} (${site.managers.length} manager(s))`);
          for (const to of site.managers) out.push({ to, text });
        } catch (err) {
          log.error(`Daily report failed for ${site.siteName}:`, err);
        }
      }
      return out;
    },
  };
}

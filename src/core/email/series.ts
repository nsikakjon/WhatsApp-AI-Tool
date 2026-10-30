import { renderEmail, type EmailContent } from "./layout.js";
import { EmailRejected, type EmailSender } from "./resend.js";
import type { EmailContact, EmailProduct, EmailStore } from "./store.js";

// The welcome and setup-tip series. Each product module writes its own emails
// and says what's true of an account (price list size, orders, members...);
// this runs them all:
//
// - Day 0 is the first time the account is live after the person agreed to
//   tips (a quote business only once its number is connected).
// - Each email is sent on or after its day, at most one a day per person, and
//   only between 8am and 8pm Lagos time. The welcome goes straight away.
// - An email with a condition ("if fewer than 5 price rows") that isn't true
//   on its day is skipped for good, so nobody is told to do what they've done.
// - The series stops when the account says so (e.g. they upgraded), except
//   for emails marked `afterStop`: feature guides that paid customers need too.
// - At most `dailyLimit` emails a day in total (Resend's free plan allows 100).

export interface AccountFacts {
  /** The account is working for its customers. */
  live: boolean;
  /** Stop this person's series, e.g. they're on a paid plan now. */
  stop?: boolean;
}

export interface SeriesEmail<F extends AccountFacts> {
  key: string;
  day: number;
  /** Only sent if this is true on its day; otherwise skipped. */
  when?: (facts: F) => boolean;
  /** Still sent once the account says stop, e.g. a feature guide for paid customers too. */
  afterStop?: boolean;
  content: (facts: F, firstName: string) => EmailContent;
}

export interface Series<F extends AccountFacts> {
  emails: Array<SeriesEmail<F>>;
  /** What's true of the account now; null when it no longer exists. */
  facts(accountId: string): Promise<F | null>;
}

export type SeriesBook = Partial<Record<EmailProduct, Series<any>>>;

export interface EmailLinks {
  /** Where the logo and photos are served, e.g. https://app.yarnoga.com/email/img */
  imageBase: string;
  unsubscribe(contactId: string): string;
}

export interface SendDueDeps {
  store: EmailStore;
  series: SeriesBook;
  send: EmailSender;
  links: EmailLinks;
  dailyLimit: number;
  now?: () => Date;
  log?: Pick<Console, "info" | "error">;
}

const DAY = 86_400_000;
/** Lagos is UTC+1 all year. */
const lagos = (d: Date) => new Date(d.getTime() + 3_600_000);
const lagosHour = (d: Date) => lagos(d).getUTCHours();
function lagosMidnight(d: Date): Date {
  const l = lagos(d);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) - 3_600_000);
}

/** "Nsikak John" -> "Nsikak"; a name without letters -> "there". */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /\p{L}/u.test(first) ? first.slice(0, 40) : "there";
}

/** Sends whatever is due now. Returns how many emails went out. */
export async function sendDueEmails(deps: SendDueDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? console;
  const contacts = (await deps.store.subscribed()).sort((a, b) => (a.tipsAt?.getTime() ?? 0) - (b.tipsAt?.getTime() ?? 0));
  if (!contacts.length) return 0;
  const sends = await deps.store.sends(contacts.map((c) => c.id));
  let sentToday = await deps.store.sentSince(lagosMidnight(now));
  const facts = new Map<string, Promise<AccountFacts | null>>();
  const addresses = new Set<string>();
  let sent = 0;

  for (const contact of contacts) {
    const series = deps.series[contact.product];
    // The same address twice on one account (e.g. from /signup and from WhatsApp) gets one series.
    const address = `${contact.product}|${contact.accountId}|${contact.email!.toLowerCase()}`;
    if (!series || addresses.has(address)) continue;
    addresses.add(address);

    const key = `${contact.product}|${contact.accountId}`;
    if (!facts.has(key)) {
      facts.set(
        key,
        series.facts(contact.accountId).catch((err) => {
          log.error(`Email series: couldn't read ${key}:`, err);
          return null;
        }),
      );
    }
    const f = await facts.get(key)!;
    if (!f || (f.stop && !series.emails.some((e) => e.afterStop))) continue;

    let start = contact.seriesStartedAt;
    if (!start) {
      if (!f.live) continue;
      start = now;
      await deps.store.update([contact.id], { seriesStartedAt: now });
    }

    const done = sends.get(contact.id) ?? [];
    const lastSent = Math.max(0, ...done.filter((d) => d.status === "sent").map((d) => d.at.getTime()));
    for (const email of series.emails) {
      if (done.some((d) => d.key === email.key) || (f.stop && !email.afterStop)) continue;
      if (now.getTime() < start.getTime() + email.day * DAY) break;
      if (email.when && !email.when(f)) {
        await deps.store.record(contact.id, email.key, "skipped");
        continue;
      }
      if (email.day > 0) {
        const hour = lagosHour(now);
        if (hour < 8 || hour >= 20 || now.getTime() - lastSent < 20 * 3_600_000) break;
      }
      if (sentToday >= deps.dailyLimit) {
        log.info(`Email series: reached the daily limit of ${deps.dailyLimit}; the rest go tomorrow.`);
        return sent;
      }
      const unsubscribeUrl = deps.links.unsubscribe(contact.id);
      const content = email.content(f, firstNameOf(contact.firstName));
      const { html, text } = renderEmail(content, { imageBase: deps.links.imageBase, unsubscribeUrl });
      try {
        const id = await deps.send({ to: contact.email!, subject: content.subject, html, text, unsubscribeUrl, idempotencyKey: `${contact.id}/${email.key}` });
        await deps.store.record(contact.id, email.key, "sent", id);
        sentToday++;
        sent++;
      } catch (err) {
        if (err instanceof EmailRejected) {
          log.error(`Email series: Resend refused ${email.key} for contact ${contact.id}:`, err);
          await deps.store.record(contact.id, email.key, "failed");
        } else {
          log.error(`Email series: couldn't send ${email.key} for contact ${contact.id}:`, err);
        }
      }
      break;
    }
  }
  if (sent) log.info(`Email series: sent ${sent} email${sent === 1 ? "" : "s"}.`);
  return sent;
}

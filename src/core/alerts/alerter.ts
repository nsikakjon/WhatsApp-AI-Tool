// Tells the platform owner (Jay) when something goes wrong: an error in the
// code, the database or WhatsApp not answering, or the server not responding.
// Each alert goes by WhatsApp and/or email, whichever is set up.
//
// Alerts are rate-limited per kind ("errors", "health:database", ...): the
// same kind at most once every 30 minutes, and the next one says how many
// were held back in between, so a burst of failures is one message, not fifty.

export interface AlertChannels {
  /** Sends a WhatsApp message to the alert number. */
  whatsapp?: (text: string) => Promise<void>;
  /** Sends an email to the alert address. */
  email?: (subject: string, text: string) => Promise<void>;
}

export interface Alerter {
  /** Sends unless the same kind was sent in the last 30 minutes. `urgent` skips the wait (e.g. "back up"). */
  alert(kind: string, subject: string, text: string, opts?: { urgent?: boolean }): Promise<void>;
}

export function createAlerter(
  channels: AlertChannels,
  opts: { gapMs?: number; now?: () => number; log?: Pick<Console, "warn"> } = {},
): Alerter {
  const gap = opts.gapMs ?? 30 * 60_000;
  const now = opts.now ?? Date.now;
  // Never console.error here: errors are themselves turned into alerts.
  const log = opts.log ?? console;
  const last = new Map<string, { at: number; held: number }>();

  return {
    async alert(kind, subject, text, o = {}) {
      const t = now();
      const entry = last.get(kind);
      if (entry && !o.urgent && t - entry.at < gap) {
        entry.held += 1;
        return;
      }
      const held = entry?.held ?? 0;
      last.set(kind, { at: t, held: 0 });
      const body = held ? `${text}\n\n(${held} more like this since the last alert.)` : text;
      const sends: Promise<void>[] = [];
      if (channels.whatsapp) sends.push(channels.whatsapp(`⚠️ yarnOga: ${subject}\n\n${body}`.slice(0, 4000)));
      if (channels.email) sends.push(channels.email(`yarnOga: ${subject}`, body));
      for (const r of await Promise.allSettled(sends)) {
        if (r.status === "rejected") log.warn(`Could not send the "${subject}" alert:`, String(r.reason));
      }
    },
  };
}

/** Email through Resend (free tier: 100 emails a day). */
export function resendEmail(opts: { apiKey: string; from: string; to: string; fetch?: typeof fetch }) {
  const doFetch = opts.fetch ?? fetch;
  return async (subject: string, text: string) => {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: opts.from, to: [opts.to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}

/**
 * Every console.error also goes to Sentry and, at most every 30 minutes, to
 * Jay. All the code already logs its failures with console.error, so this
 * catches them all without touching each place. Crashes outside any request
 * (unhandled promise rejections) are caught too.
 */
export function watchErrors(opts: {
  sentry?: { capture(err: unknown, extra?: Record<string, unknown>): void } | null;
  alerter?: Alerter;
  target?: Pick<Console, "error">;
  onProcess?: boolean;
}): () => void {
  const target = opts.target ?? console;
  const original = target.error.bind(target);
  let inside = false;
  target.error = (...args: unknown[]) => {
    original(...args);
    if (inside) return; // an alert that fails mustn't set off another alert
    inside = true;
    try {
      const err = args.find((a) => a instanceof Error) as Error | undefined;
      const words = args.filter((a) => typeof a === "string").join(" ");
      const message = [words, err ? `${err.name}: ${err.message}` : ""].filter(Boolean).join(" ").slice(0, 1000);
      opts.sentry?.capture(err ?? new Error(words || "Unknown error"), err && words ? { context: words } : undefined);
      void opts.alerter
        ?.alert("errors", "an error happened", `${message}\n\nFull details are in Sentry and the Railway logs.`)
        .catch(() => {});
    } finally {
      inside = false;
    }
  };
  const onRejection = (reason: unknown) => target.error("Unhandled promise rejection:", reason);
  if (opts.onProcess) process.on("unhandledRejection", onRejection);
  return () => {
    target.error = original;
    if (opts.onProcess) process.off("unhandledRejection", onRejection);
  };
}

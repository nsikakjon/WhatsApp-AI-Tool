import { randomUUID } from "node:crypto";

// Sends errors to Sentry (free tier), so every crash is listed in one place
// with when it happened and where in the code. A small client of our own
// rather than Sentry's SDK: it only sends errors, adds nothing to start-up,
// and can't change how the server runs. Switched on by SENTRY_DSN.
//
// At most 30 errors are sent per 10 minutes, and the same error at most once
// a minute, so a broken loop can't use up the free tier's monthly quota.

export interface ErrorReporter {
  capture(err: unknown, extra?: Record<string, unknown>): void;
}

export interface SentryOptions {
  dsn: string;
  environment?: string;
  release?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Dsn {
  key: string;
  envelopeUrl: string;
  raw: string;
}

/** https://<key>@o123.ingest.sentry.io/456 -> where to send events. Null if it isn't a DSN. */
export function parseDsn(dsn: string): Dsn | null {
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  const project = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!url.username || !/^\d+$/.test(project) || url.protocol !== "https:") return null;
  return { key: url.username, envelopeUrl: `https://${url.host}/api/${project}/envelope/`, raw: dsn.trim() };
}

/** Turns a Node stack trace into Sentry's frames (oldest call first). */
export function stackFrames(stack: string | undefined) {
  const frames: Array<{ function?: string; filename: string; lineno?: number; colno?: number; in_app: boolean }> = [];
  for (const line of (stack ?? "").split("\n").slice(1)) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const filename = m[2]!.replace(/^file:\/\//, "");
    frames.push({
      function: m[1],
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
  }
  return frames.reverse();
}

export function createSentry(opts: SentryOptions): ErrorReporter | null {
  const dsn = parseDsn(opts.dsn);
  if (!dsn) return null;
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const recent = new Map<string, number>();
  let windowStart = 0;
  let sentInWindow = 0;

  return {
    capture(err, extra) {
      const error = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
      const t = now();
      const fingerprint = `${error.name}:${error.message}`.slice(0, 300);
      if ((recent.get(fingerprint) ?? 0) > t - 60_000) return;
      if (t - windowStart > 10 * 60_000) {
        windowStart = t;
        sentInWindow = 0;
      }
      if (sentInWindow >= 30) return;
      sentInWindow += 1;
      recent.set(fingerprint, t);
      if (recent.size > 500) recent.clear();

      const eventId = randomUUID().replace(/-/g, "");
      const event = {
        event_id: eventId,
        timestamp: t / 1000,
        platform: "node",
        level: "error",
        environment: opts.environment ?? "production",
        release: opts.release,
        server_name: "yarnoga",
        exception: {
          values: [{ type: error.name, value: error.message, stacktrace: { frames: stackFrames(error.stack) } }],
        },
        extra,
      };
      const body = [
        JSON.stringify({ event_id: eventId, sent_at: new Date(t).toISOString(), dsn: dsn.raw }),
        JSON.stringify({ type: "event" }),
        JSON.stringify(event),
      ].join("\n");
      // Fire and forget: reporting an error must never cause another one.
      doFetch(dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=yarnoga/1.0`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    },
  };
}

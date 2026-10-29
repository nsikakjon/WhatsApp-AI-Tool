import { Hono } from "hono";
import type { Alerter } from "./alerts/alerter.js";

// Is everything working? Three answers:
//   GET /health          "the server is up" (what Railway checks; no database call)
//   GET /health/full     every check below, as JSON; 503 when one fails.
//                        Point an uptime monitor (UptimeRobot, Better Stack,
//                        or the GitHub workflow in .github/workflows) here.
//   GET /status          the same as a page anyone can read
// Each check is something the bots need: the database, WhatsApp's API, the
// AI. A watchdog runs them every few minutes and alerts Jay when one fails
// twice in a row, and again when it recovers.

export type Check = () => Promise<string | void>;

export interface CheckResult {
  ok: boolean;
  ms: number;
  /** A short note: what failed, or a detail like "last message 3 minutes ago". */
  note?: string;
}

export interface HealthReport {
  ok: boolean;
  checkedAt: string;
  uptimeSeconds: number;
  version: string | null;
  checks: Record<string, CheckResult>;
}

export interface HealthDeps {
  checks: Record<string, Check>;
  /** Labels shown on the status page, e.g. { database: "Database (Supabase)" }. */
  labels?: Record<string, string>;
  timeoutMs?: number;
  version?: string | null;
  startedAt?: number;
  now?: () => number;
}

export async function runChecks(deps: HealthDeps): Promise<HealthReport> {
  const now = deps.now ?? Date.now;
  const timeout = deps.timeoutMs ?? 8000;
  const entries = await Promise.all(
    Object.entries(deps.checks).map(async ([name, check]): Promise<[string, CheckResult]> => {
      const start = now();
      try {
        const note = await Promise.race([
          check(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${timeout / 1000}s`)), timeout)),
        ]);
        return [name, { ok: true, ms: now() - start, ...(note ? { note } : {}) }];
      } catch (err) {
        return [name, { ok: false, ms: now() - start, note: err instanceof Error ? err.message.slice(0, 200) : String(err) }];
      }
    }),
  );
  const checks = Object.fromEntries(entries);
  return {
    ok: entries.every(([, r]) => r.ok),
    checkedAt: new Date(now()).toISOString(),
    uptimeSeconds: Math.round((now() - (deps.startedAt ?? now())) / 1000),
    version: deps.version ?? null,
    checks,
  };
}

export function createHealthRoutes(deps: HealthDeps) {
  const app = new Hono();
  // Checks call outside services, so answer from a recent run when asked often.
  let cached: { at: number; report: HealthReport } | null = null;
  const now = deps.now ?? Date.now;
  const report = async () => {
    if (cached && now() - cached.at < 20_000) return cached.report;
    const r = await runChecks(deps);
    cached = { at: now(), report: r };
    return r;
  };

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/health/full", async (c) => {
    const r = await report();
    c.header("Cache-Control", "no-store");
    return c.json(r, r.ok ? 200 : 503);
  });
  app.get("/status", async (c) => {
    const r = await report();
    c.header("Cache-Control", "no-store");
    return c.html(statusPage(r, deps.labels ?? {}), r.ok ? 200 : 503);
  });
  return app;
}

export function statusPage(r: HealthReport, labels: Record<string, string>): string {
  const rows = Object.entries(r.checks)
    .map(
      ([name, c]) =>
        `<tr><td>${esc(labels[name] ?? name)}</td><td class="${c.ok ? "up" : "down"}">${c.ok ? "Working" : "Not working"}</td><td>${c.ms} ms</td><td class="muted">${esc(c.note ?? "")}</td></tr>`,
    )
    .join("");
  const up = r.uptimeSeconds;
  const uptime = up > 86400 ? `${Math.floor(up / 86400)} days` : up > 3600 ? `${Math.floor(up / 3600)} hours` : `${Math.floor(up / 60)} minutes`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60"><meta name="robots" content="noindex"><title>yarnOga status</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0c0d0d;color:#f3f4ef}main{max-width:760px;margin:0 auto;padding:32px 16px}
h1{font-size:1.6rem}.big{font-size:1.25rem;font-weight:700;padding:14px 16px;border-radius:10px;margin:16px 0}
.okb{background:#1c2a05;color:#c6ff1f}.badb{background:#3a1010;color:#ff8a80}table{width:100%;border-collapse:collapse}
td{padding:10px 6px;border-bottom:1px solid #2e302f;vertical-align:top}.up{color:#c6ff1f;font-weight:700}.down{color:#ff8a80;font-weight:700}.muted{color:#9a9d97;font-size:.9rem}</style>
</head><body><main><h1>yarnOga status</h1>
<p class="big ${r.ok ? "okb" : "badb"}">${r.ok ? "All systems working" : "Something isn't working. We've been alerted."}</p>
<table>${rows}</table>
<p class="muted">Checked ${esc(r.checkedAt.replace("T", " ").slice(0, 16))} UTC · server up for ${uptime}${r.version ? ` · version ${esc(r.version.slice(0, 7))}` : ""}. This page refreshes every minute.</p>
</main></body></html>`;
}

/**
 * Runs the checks on a timer and alerts on changes: a check that fails twice
 * in a row ("down"), then again once it works ("back up").
 */
export function createWatchdog(deps: HealthDeps & { alerter: Alerter; labels?: Record<string, string> }) {
  const failures = new Map<string, number>();
  const down = new Set<string>();
  return async function tick() {
    const r = await runChecks(deps);
    for (const [name, c] of Object.entries(r.checks)) {
      const label = deps.labels?.[name] ?? name;
      if (!c.ok) {
        const n = (failures.get(name) ?? 0) + 1;
        failures.set(name, n);
        if (n >= 2 && !down.has(name)) {
          down.add(name);
          await deps.alerter.alert(`health:${name}`, `${label} is down`, `${label} has failed two checks in a row: ${c.note ?? "no reason given"}.\n\nStatus page: /status`, { urgent: true });
        }
      } else {
        failures.set(name, 0);
        if (down.delete(name)) {
          await deps.alerter.alert(`health:${name}`, `${label} is back up`, `${label} is working again.`, { urgent: true });
        }
      }
    }
    return r;
  };
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

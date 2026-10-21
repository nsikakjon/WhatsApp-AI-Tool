// Reading spreadsheets people send us: CSV files, and Google Sheets shared by
// link. Shared by any part of the app that imports a list (flyer members,
// quote bot price lists).

const TIMEOUT_MS = 20_000;

/** Reads CSV text (commas or semicolons, quoted cells allowed) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/** A Google Sheets link -> the link that downloads it as CSV, or null if it isn't one. */
export function sheetCsvUrl(link: string): string | null {
  const m = link.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (!m) return null;
  const gid = link.match(/[#?&]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

/**
 * Only fetch public web addresses: https, a real domain name, nothing that
 * points back inside our own server or network.
 */
export function isSafeUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return false; // raw IP addresses
  return host.includes(".");
}

/** Fetches a public URL, following up to 5 redirects and checking each hop. */
export async function safeFetch(url: string, doFetch: typeof fetch): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    if (!isSafeUrl(current)) throw new Error("that link isn't a public https link");
    const res = await doFetch(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      current = new URL(next, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

/** Downloads a Google Sheet as CSV. It must be shared as "Anyone with the link". */
export async function fetchSheet(link: string, doFetch: typeof fetch = fetch): Promise<string> {
  const url = sheetCsvUrl(link);
  if (!url) throw new Error("that isn't a Google Sheets link");
  const res = await safeFetch(url, doFetch);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) {
    throw new Error('the sheet isn\'t public. In Google Sheets, tap Share and set "Anyone with the link" to Viewer');
  }
  return res.text();
}

/** True for files that look like a CSV export. */
export function isCsv(mimeType: string): boolean {
  return /^(text\/(csv|comma-separated-values|plain)|application\/(csv|vnd\.ms-excel))$/.test(mimeType);
}

import { nameTokens } from "./aml.js";

// Sanctions screening against the public lists, with no paid provider: the UN
// Security Council consolidated list (which Nigeria's own list follows) and
// the US Treasury's SDN list, which banks and Paystack also screen against.
// Both are downloaded at most once a day and kept in memory.
//
// A hit isn't a finding: common names match. Jay looks at each one on the
// compliance page before approving.

export const UN_LIST_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";
export const OFAC_SDN_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV";

export interface ListedName {
  list: "UN" | "OFAC";
  name: string;
  /** The list's own reference, e.g. QDi.123 or the SDN number. */
  ref: string;
}

export interface ScreeningResult {
  /** The names screened: the business, its owner or director, and its bank account name. */
  names: string[];
  hits: Array<ListedName & { matched: string }>;
  /** The lists that loaded; a list missing here wasn't checked. */
  lists: string[];
  error?: string;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();

const tagValues = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => decode(m[1]!)).filter(Boolean);

/** Every name and alias of the people and organisations on the UN list. */
export function parseUnList(xml: string): ListedName[] {
  const out: ListedName[] = [];
  for (const [, block] of xml.matchAll(/<(?:INDIVIDUAL|ENTITY)>([\s\S]*?)<\/(?:INDIVIDUAL|ENTITY)>/g)) {
    const ref = tagValues(block!, "REFERENCE_NUMBER")[0] ?? "";
    const main = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].map((t) => tagValues(block!, t)[0] ?? "").filter(Boolean).join(" ");
    for (const name of [main, ...tagValues(block!, "ALIAS_NAME")]) if (name) out.push({ list: "UN", name, ref });
  }
  return out;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** The names on the SDN list. Individuals are "SURNAME, Given names"; turned round so they read like a name. */
export function parseSdnList(csv: string): ListedName[] {
  return csvRows(csv)
    .filter((r) => r.length > 2 && /^\d+$/.test(r[0]!.trim()))
    .map((r) => {
      const raw = r[1]!.trim();
      const individual = r[2]!.trim().toLowerCase() === "individual";
      const [surname, given] = raw.split(/,\s*/, 2);
      return { list: "OFAC" as const, name: individual && given ? `${given} ${surname}` : raw, ref: r[0]!.trim() };
    });
}

/**
 * Whether a name we hold is the listed one: every word of a name of two or
 * more words appears in the listed name (or the other way round), in any
 * order. One-word names only match one-word entries exactly, as a single word
 * like "Grace" or "Global" matches too much.
 */
export function screenMatch(ours: string, listed: string): boolean {
  const q = nameTokens(ours);
  const e = nameTokens(listed);
  if (!q.length || !e.length) return false;
  if (q.length === 1 || e.length === 1) return q.length === e.length && q[0] === e[0];
  const es = new Set(e);
  const qs = new Set(q);
  return q.every((w) => es.has(w)) || e.every((w) => qs.has(w));
}

export interface Screener {
  screen(names: Array<string | null | undefined>): Promise<ScreeningResult>;
}

export function createScreener(opts: { fetch?: typeof fetch; now?: () => number; log?: Pick<Console, "warn"> } = {}): Screener {
  const get = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console;
  const cache = new Map<string, { at: number; names: ListedName[] }>();

  async function load(label: string, url: string, parse: (text: string) => ListedName[]): Promise<ListedName[] | null> {
    const held = cache.get(label);
    if (held && now() - held.at < 86_400_000) return held.names;
    try {
      const res = await get(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const names = parse(await res.text());
      if (!names.length) throw new Error("the list came back empty");
      cache.set(label, { at: now(), names });
      return names;
    } catch (err) {
      log.warn(`Sanctions screening: couldn't load the ${label} list:`, String(err));
      return held?.names ?? null;
    }
  }

  return {
    async screen(raw) {
      const names = [...new Set(raw.map((n) => n?.trim()).filter((n): n is string => Boolean(n)))];
      const [un, ofac] = await Promise.all([load("UN", UN_LIST_URL, parseUnList), load("OFAC", OFAC_SDN_URL, parseSdnList)]);
      const lists = [...(un ? ["UN"] : []), ...(ofac ? ["OFAC"] : [])];
      const hits: ScreeningResult["hits"] = [];
      for (const entry of [...(un ?? []), ...(ofac ?? [])]) {
        const matched = names.find((n) => screenMatch(n, entry.name));
        if (matched && !hits.some((h) => h.list === entry.list && h.ref === entry.ref)) hits.push({ ...entry, matched });
      }
      return { names, hits: hits.slice(0, 20), lists, ...(lists.length < 2 ? { error: "Not every list could be loaded; screen again later." } : {}) };
    },
  };
}

// Bulk import of members from a spreadsheet: a CSV file sent on WhatsApp, or a
// Google Sheets link. Each row has a name, a birthday and, optionally, a link
// to a photo (for example a Google Drive link from a Google Form upload).
import { parseBirthday, type MonthDay } from "./dates.js";
import type { Picture } from "./store.js";
import { safeFetch } from "../../core/sheets.js";

// The spreadsheet helpers moved to the core so other products can use them.
export { fetchSheet, isCsv, isSafeUrl, parseCsv, sheetCsvUrl } from "../../core/sheets.js";

export interface ImportRow {
  /** Row number as the admin sees it in their spreadsheet (header is row 1). */
  line: number;
  name: string;
  birthday: MonthDay | null;
  /** What the birthday cell said, to quote back if it couldn't be read. */
  birthdayText: string;
  photoUrl?: string;
}

export const MAX_ROWS = 1000;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

type Column = "name" | "birthday" | "photo";

function columnFor(header: string): Column | null {
  const h = header.toLowerCase();
  if (/photo|picture|pic\b|image|selfie|passport/.test(h)) return "photo";
  if (/birth|dob|date/.test(h)) return "birthday";
  if (/name/.test(h)) return "name";
  return null;
}

/**
 * Picks out the name, birthday and photo columns (by their headings, or in
 * that order if there are no headings) and reads each row.
 */
export function rowsFromTable(table: string[][]): ImportRow[] {
  if (!table.length) return [];
  const header = table[0]!.map(columnFor);
  const hasHeader = header.includes("name") && header.includes("birthday");
  const index = (col: Column, fallback: number) => (hasHeader ? header.indexOf(col) : fallback);
  const nameAt = index("name", 0);
  const birthdayAt = index("birthday", 1);
  const photoAt = index("photo", 2);
  const body = hasHeader ? table.slice(1) : table;
  const firstLine = hasHeader ? 2 : 1;

  const birthdayCells = body.map((r) => r[birthdayAt] ?? "");
  const dayFirst = guessDayFirst(birthdayCells);

  return body
    .map((r, i) => {
      const birthdayText = r[birthdayAt] ?? "";
      const photo = photoAt >= 0 ? (r[photoAt] ?? "").split(/[\s,]+/).find((p) => /^https?:\/\//i.test(p)) : undefined;
      return {
        line: firstLine + i,
        name: (r[nameAt] ?? "").replace(/\s+/g, " ").trim(),
        birthday: readDate(birthdayText, dayFirst),
        birthdayText,
        photoUrl: photo,
      };
    })
    .filter((r) => r.name);
}

/**
 * Whether dates like 03/04 mean 3 April (day first, as in Nigeria) or
 * March 4 (month first, as some Google Sheets set to US style export them).
 * Decided from the whole column: any first number over 12 means day first,
 * any second number over 12 means month first. Day first if unclear.
 */
export function guessDayFirst(cells: string[]): boolean {
  let dayFirst = false;
  let monthFirst = false;
  for (const cell of cells) {
    const m = cell.match(/^\s*(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?\b/);
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirst = true;
    if (Number(m[2]) > 12) monthFirst = true;
  }
  return !(monthFirst && !dayFirst);
}

function readDate(text: string, dayFirst: boolean): MonthDay | null {
  // 1990-03-14
  const iso = text.match(/^\s*\d{4}-(\d{1,2})-(\d{1,2})/);
  if (iso) return parseBirthday(`${iso[2]}/${iso[1]}`);
  const numeric = text.match(/^\s*(\d{1,2})[/.-](\d{1,2})(?:[/.-]\d{2,4})?\s*$/);
  if (numeric && !dayFirst) return parseBirthday(`${numeric[2]}/${numeric[1]}`);
  return parseBirthday(text);
}

/** Google Drive share links -> a direct download link. Other links are used as they are. */
export function photoDownloadUrl(link: string): string {
  const drive =
    link.match(/https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/) ??
    link.match(/https:\/\/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]+)/);
  return drive ? `https://drive.google.com/uc?export=download&id=${drive[1]}` : link;
}

/** Downloads a member photo from a link (Google Drive or any public picture link). */
export async function fetchPicture(link: string, doFetch: typeof fetch = fetch): Promise<Picture> {
  const res = await safeFetch(photoDownloadUrl(link), doFetch);
  if (!res.ok) throw new Error(`the photo link didn't work (${res.status})`);
  const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) {
    throw new Error("the link isn't a picture, or isn't shared publicly");
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES) throw new Error("the photo is too large");
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > MAX_PHOTO_BYTES) throw new Error("the photo is too large");
  return { data, mimeType };
}

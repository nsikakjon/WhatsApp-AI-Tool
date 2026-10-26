import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Lang } from "../../core/i18n.js";

// The words drawn on the birthday designs, in English and French. French words
// are longer ("ANNIVERSAIRE" against "BIRTHDAY"), so designs shrink them to fit
// with fitWidth rather than letting them run off the flyer.

export interface FlyerWords {
  lang: Lang;
  /** The script word above the big one: "Happy" / "Joyeux". */
  happy: string;
  /** The big word: "Birthday" / "Anniversaire". */
  birthday: string;
  /** Both on one line: "Happy Birthday" / "Joyeux anniversaire". */
  happyBirthday: string;
  celebration: string;
  /** "Ada's Birthday" / "Anniversaire d'Ada". */
  birthdayOf(first: string): string;
  /** 14 -> "14TH" / "14", 1 -> "1ST" / "1ER". */
  ordinal(day: number): string;
  months: string[];
  /** Calendar column heads, Sunday first. */
  weekdays: string[];
}

export const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function englishOrdinal(n: number): string {
  const s = ["TH", "ST", "ND", "RD"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]!);
}

const EN: FlyerWords = {
  lang: "en",
  happy: "Happy",
  birthday: "Birthday",
  happyBirthday: "Happy Birthday",
  celebration: "Birthday Celebration",
  birthdayOf: (first) => `${first}'s Birthday`,
  ordinal: englishOrdinal,
  months: MONTHS_EN,
  weekdays: ["SU", "MO", "TU", "WE", "TH", "FR", "SA"],
};

const FR: FlyerWords = {
  lang: "fr",
  happy: "Joyeux",
  birthday: "Anniversaire",
  happyBirthday: "Joyeux anniversaire",
  celebration: "Fête d'anniversaire",
  birthdayOf: (first) => `Anniversaire ${/^[aeiouyhâéèêîïôûü]/i.test(first) ? "d'" : "de "}${first}`,
  ordinal: (n) => (n === 1 ? "1ER" : String(n)),
  months: MONTHS_FR,
  weekdays: ["DI", "LU", "MA", "ME", "JE", "VE", "SA"],
};

export function flyerWords(lang: Lang | undefined): FlyerWords {
  return lang === "fr" ? FR : EN;
}

/**
 * Shrinks the current font until the text is at most maxWidth wide (letter
 * spacing included), keeping the font family. Returns the size used.
 */
export function fitWidth(ctx: SKRSContext2D, text: string, maxWidth: number, spacing = 0): number {
  const m = ctx.font.match(/(\d+(?:\.\d+)?)px/);
  if (!m) return 0;
  let size = Number(m[1]);
  const width = () => ctx.measureText(text).width + spacing * Math.max(0, [...text].length - 1);
  while (width() > maxWidth && size > 10) {
    size = Math.floor(size * 0.95);
    ctx.font = ctx.font.replace(/\d+(?:\.\d+)?px/, `${size}px`);
  }
  return size;
}

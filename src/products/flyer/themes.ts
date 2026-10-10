// The flyer designs groups can choose from (they send "design" to see them).
//
// To change a design, edit its colours or layout below. To add one, copy a
// block and give it a new id. Colours are web colour codes like "#f5c451";
// pick them with any online "colour picker". Changes go live on the next deploy.

export interface Theme {
  /** Short id saved for the group, e.g. "royal". Don't rename once groups use it. */
  id: string;
  /** Name shown to admins. */
  label: string;
  /**
   * "circle": round photo in the middle with a coloured ring.
   * "full": the photo fills the top of the flyer and fades into the colour below.
   */
  layout: "circle" | "full";
  /** Background, top-left to bottom-right. Use the same colour twice for a flat one. */
  background: [string, string];
  /** "Happy", the photo ring, the date, and the line on event flyers. */
  accent: string;
  /** "BIRTHDAY" and the name. */
  text: string;
  /** The group name and small print. */
  muted: string;
  /** Sprinkle confetti on the background. */
  confetti: boolean;
}

export const THEMES: Theme[] = [
  {
    id: "royal",
    label: "Royal purple",
    layout: "circle",
    background: ["#1d1350", "#6b1757"],
    accent: "#f5c451",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: true,
  },
  {
    id: "emerald",
    label: "Emerald and gold",
    layout: "circle",
    background: ["#04382b", "#0b6e4f"],
    accent: "#f5c451",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: true,
  },
  {
    id: "sunset",
    label: "Sunset",
    layout: "circle",
    background: ["#ff7a45", "#d6246e"],
    accent: "#fff3c4",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.9)",
    confetti: true,
  },
  {
    id: "classic",
    label: "Classic cream",
    layout: "circle",
    background: ["#fbf6ec", "#efe3c8"],
    accent: "#b8860b",
    text: "#1f2a44",
    muted: "rgba(31,42,68,0.75)",
    confetti: false,
  },
  {
    id: "photo",
    label: "Big photo, navy",
    layout: "full",
    background: ["#0d1b3d", "#0d1b3d"],
    accent: "#f5c451",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.8)",
    confetti: false,
  },
  {
    id: "midnight",
    label: "Big photo, black and gold",
    layout: "full",
    background: ["#0b0b0b", "#0b0b0b"],
    accent: "#d4af37",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.75)",
    confetti: false,
  },
];

export const DEFAULT_THEME_ID = "royal";

/** Finds a design by number ("2"), id ("emerald") or name ("emerald and gold"). */
export function findTheme(query: string): Theme | undefined {
  const q = query.trim().toLowerCase();
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= THEMES.length) return THEMES[n - 1];
  return THEMES.find((t) => t.id === q || t.label.toLowerCase() === q) ?? THEMES.find((t) => t.label.toLowerCase().includes(q));
}

/** The group's design, falling back to the default if it was removed. */
export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

/** Colour names admins can type after "colour". Anything else must be a code like #1a7f37. */
const NAMED_COLOURS: Record<string, string> = {
  gold: "#f5c451",
  yellow: "#ffd60a",
  orange: "#ff8c1a",
  red: "#e63946",
  pink: "#ff6fae",
  purple: "#9b5de5",
  blue: "#3a86ff",
  green: "#2dc653",
  teal: "#14b8a6",
  white: "#ffffff",
  silver: "#c0c0c0",
  black: "#111111",
};

/** "gold" or "#F5C451" -> "#f5c451"; anything else -> null. */
export function parseColour(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (NAMED_COLOURS[t]) return NAMED_COLOURS[t];
  return /^#?[0-9a-f]{6}$/.test(t) ? `#${t.replace("#", "")}` : null;
}

export const COLOUR_NAMES = Object.keys(NAMED_COLOURS);

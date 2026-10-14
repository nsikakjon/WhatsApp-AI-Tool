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
   * "stars": a gold card with a big round photo, the birthday message beside it,
   *   and foil balloon stars (drawn in goldstars.ts; the colours below are only
   *   used for the photo outline when a member has no photo).
   * "gala", "sunflower", "whitegold", "calendar": the four ready-made designs
   *   in designs4.ts. They draw their own colours; the ones below are only used
   *   for the initials picture when a member has no photo.
   * "goldportrait", "redpeach", "blackgold", "whiteconfetti", "bigdate",
   *   "polaroidnote", "balloons": the seven ready-made designs in designs7.ts.
   */
  layout:
    | "circle"
    | "full"
    | "stars"
    | "gala"
    | "sunflower"
    | "whitegold"
    | "calendar"
    | "goldportrait"
    | "redpeach"
    | "blackgold"
    | "whiteconfetti"
    | "bigdate"
    | "polaroidnote"
    | "balloons";
  /**
   * Stands the person in front of the design using their cut-out photo (the
   * background removed, see cutout.ts), falling back to the plain photo.
   */
  cutout?: boolean;
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
    cutout: true,
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
    cutout: true,
    label: "Big photo, black and gold",
    layout: "full",
    background: ["#0b0b0b", "#0b0b0b"],
    accent: "#d4af37",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.75)",
    confetti: false,
  },
  {
    id: "goldstars",
    label: "Gold stars and glitter",
    layout: "stars",
    background: ["#c98a2c", "#e8a33a"],
    accent: "#fff3c4",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },  {
    id: "gala",
    cutout: true,
    label: "Evening gala",
    layout: "gala",
    background: ["#2a1109", "#5a2414"],
    accent: "#f3cf6b",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "sunflower",
    cutout: true,
    label: "Sunflowers",
    layout: "sunflower",
    background: ["#e8731c", "#f59a2c"],
    accent: "#ffffff",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "whitegold",
    cutout: true,
    label: "White and gold",
    layout: "whitegold",
    background: ["#b8862f", "#e2c172"],
    accent: "#ffffff",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "calendar",
    cutout: true,
    label: "Calendar",
    layout: "calendar",
    background: ["#c62828", "#e0524f"],
    accent: "#ffffff",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "goldportrait",
    label: "Gold portrait",
    layout: "goldportrait",
    cutout: true,
    background: ["#8c5a22", "#b7843a"],
    accent: "#ffe2a8",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "redpeach",
    label: "Red and peach",
    layout: "redpeach",
    cutout: true,
    background: ["#cf1f2e", "#f7dcc6"],
    accent: "#ffffff",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "blackgold",
    label: "Black and gold rings",
    layout: "blackgold",
    background: ["#0b0b0b", "#2a2a2a"],
    accent: "#d4af37",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "whiteconfetti",
    label: "White confetti",
    layout: "whiteconfetti",
    background: ["#e8452c", "#f6c90e"],
    accent: "#ffffff",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "bigdate",
    label: "Big date, blue",
    layout: "bigdate",
    cutout: true,
    background: ["#0a2a8f", "#2f6bff"],
    accent: "#ffffff",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "polaroidnote",
    label: "Polaroid note",
    layout: "polaroidnote",
    background: ["#c98a5c", "#f9ead6"],
    accent: "#ffffff",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
    confetti: false,
  },
  {
    id: "balloons",
    label: "Orange balloons",
    layout: "balloons",
    background: ["#ff6a00", "#ff8c1a"],
    accent: "#ffffff",
    text: "#ffffff",
    muted: "rgba(255,255,255,0.85)",
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

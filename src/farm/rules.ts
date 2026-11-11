import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// The crop library and its "What needs attention" rules live in one place:
// farm-app/js/crops.js, which the phone loads as a plain script. The server
// runs that same file (in a sealed-off sandbox with nothing but its own code)
// so a WhatsApp alert always says exactly what the app would show. Change
// crop advice in crops.js, never here.

export type InsightLevel = "high" | "med" | "info" | "low";
/** crop: crop + weather + season · weather · sat: satellite · scout: from the farmer's own scouting. */
export type InsightKind = "crop" | "weather" | "sat" | "scout";

export interface Insight {
  level: InsightLevel;
  title: string;
  text: string;
  kind: InsightKind;
}

/** A field as the app saves it (only the parts the rules read). */
export type FieldData = Record<string, unknown>;

export interface FarmRules {
  /** The app's alerts for a field, most urgent first. `wx` is the Open-Meteo answer the phone keeps (see weather.ts). */
  insights(field: FieldData, wx: unknown, now: Date): Insight[];
  /** State capitals' [lat, lon], used for weather until a field has a boundary or pin. */
  states: Record<string, [number, number]>;
  cropName(id: string): string | null;
}

const CROPS_JS = fileURLToPath(new URL("../../farm-app/js/crops.js", import.meta.url));

let loaded: FarmRules | null = null;

/** Loads crops.js once. `source` is for tests. */
export function farmRules(source?: string): FarmRules {
  if (loaded && source === undefined) return loaded;
  const code = source ?? readFileSync(CROPS_JS, "utf8");
  const sandbox = vm.createContext({});
  vm.runInContext(code, sandbox, { filename: "crops.js", timeout: 1000 });
  // Top-level `const`s in a classic script are shared with later scripts in the same context.
  const api = vm.runInContext("({ insights, STATES, CROPS })", sandbox) as {
    insights(field: unknown, wx: unknown, now: Date): Array<{ level: string; title: string; text: string; kind?: string }>;
    STATES: Record<string, [number, number]>;
    CROPS: Record<string, { name: string }>;
  };
  const rules: FarmRules = {
    insights(field, wx, now) {
      // Plain copies in, plain copies out: nothing from the sandbox leaks into the server.
      const f = JSON.parse(JSON.stringify(field)) as Record<string, unknown>;
      const w = wx == null ? null : JSON.parse(JSON.stringify(wx));
      const when = vm.runInContext(`new Date(${now.getTime()})`, sandbox) as Date;
      return api.insights(f, w, when).map((i) => ({
        level: i.level as InsightLevel,
        title: String(i.title),
        text: String(i.text),
        kind: (i.kind ?? "crop") as InsightKind,
      }));
    },
    states: JSON.parse(JSON.stringify(api.STATES)),
    cropName: (id) => api.CROPS[id]?.name ?? null,
  };
  if (source === undefined) loaded = rules;
  return rules;
}

// How two copies of the same field are combined when phones sync.
//
// Farm phones are often offline, so two people (say the owner and the farm
// manager) can both change a field before either syncs. Instead of the last
// phone wiping out the other's work:
//   - lists of things with an id (scouting walks, harvests and costs, tasks,
//     beacons, site features) are combined: nothing either phone added is lost,
//     and when both changed the same item the phone syncing now wins;
//   - anything either phone deleted stays deleted (the `deleted` list);
//   - site details, ticked boxes and task progress are combined key by key;
//   - everything else (name, crop, location) comes from the phone syncing now.

const LISTS = ["beacons", "features", "scouts", "records", "tasks"] as const;
const MAPS = ["f", "checks", "taskState"] as const;
/** Kept on the phone only: weather is fetched per phone, the rest is app bookkeeping. */
const LOCAL_ONLY = ["wx", "sat", "demo", "_dirty", "_ver", "_synced", "_owner", "_role", "_ownerName"];
const MAX_DELETED = 1000;

type Obj = Record<string, unknown>;
type Item = Obj & { id?: unknown };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Removes what shouldn't be stored on the server. */
export function cleanField(data: Obj): Obj {
  const out: Obj = { ...data };
  for (const k of LOCAL_ONLY) delete out[k];
  return out;
}

export function mergeField(server: Obj | null, incoming: Obj): Obj {
  const inc = cleanField(incoming);
  if (!server) return inc;
  const out: Obj = { ...server, ...inc };

  const deleted = [...new Set([...ids(server.deleted), ...ids(inc.deleted)])].slice(-MAX_DELETED);
  const gone = new Set(deleted);
  out.deleted = deleted;

  for (const key of LISTS) {
    const a = Array.isArray(server[key]) ? (server[key] as Item[]) : [];
    const b = Array.isArray(inc[key]) ? (inc[key] as Item[]) : [];
    const byId = new Map<string, Item>();
    for (const it of a) if (isObj(it) && typeof it.id === "string") byId.set(it.id, it);
    const merged: Item[] = [];
    const seen = new Set<string>();
    // The syncing phone's order first (it matters for beacons), then anything only the server had.
    for (const it of b) {
      if (!isObj(it) || typeof it.id !== "string" || gone.has(it.id) || seen.has(it.id)) continue;
      seen.add(it.id);
      merged.push(it);
    }
    for (const it of a) {
      if (!isObj(it) || typeof it.id !== "string" || gone.has(it.id) || seen.has(it.id)) continue;
      seen.add(it.id);
      merged.push(it);
    }
    out[key] = merged;
  }

  for (const key of MAPS) {
    const a = isObj(server[key]) ? (server[key] as Obj) : {};
    const b = isObj(inc[key]) ? (inc[key] as Obj) : {};
    out[key] = { ...a, ...b };
  }
  return out;
}

import type { FarmStore, FieldRow, SatelliteRow } from "./store.js";
import { ringHectares, type Satellite } from "./satellite.js";

// The saved satellite results for each field (migration 0077), shared by the
// app's satellite card and the daily WhatsApp alerts. The satellite service
// is asked at most every 12 hours per field, and two requests for the same
// field at once share one fetch.

export const SAT_MAX_HA = 2000;
export const SAT_REFRESH_MS = 12 * 3600_000;

export type SatResult =
  | { kind: "needsBoundary" }
  | { kind: "tooBig" }
  | { kind: "ok"; row: SatelliteRow; stale?: boolean; error?: unknown }
  | { kind: "failed"; error: unknown };

export interface SatelliteCache {
  /** The field's results, fetching new ones when the saved ones are old or for another boundary. */
  get(field: FieldRow): Promise<SatResult>;
}

export function createSatelliteCache(deps: { store: FarmStore; satellite: Satellite; now: () => Date }): SatelliteCache {
  const busy = new Map<string, Promise<SatelliteRow>>();
  return {
    async get(field) {
      const ring = boundaryRing(field.data);
      if (!ring) return { kind: "needsBoundary" };
      if (ringHectares(ring) > SAT_MAX_HA) return { kind: "tooBig" };
      const key = ring.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
      const cached = await deps.store.satellite(field.id);
      const fresh = cached && cached.boundaryKey === key && deps.now().getTime() - cached.fetchedAt.getTime() < SAT_REFRESH_MS;
      if (fresh) return { kind: "ok", row: cached };
      let job = busy.get(field.id);
      if (!job) {
        job = (async () => {
          const to = deps.now();
          const series = await deps.satellite.ndviSeries(ring, new Date(to.getTime() - 365 * 86400_000), to);
          const latest = series[series.length - 1];
          const sameImage = cached && cached.boundaryKey === key && latest && cached.imageDate === latest.date;
          const image = latest && !sameImage ? await deps.satellite.ndviImage(ring, latest.date) : null;
          const row: SatelliteRow = { boundaryKey: key, series, fetchedAt: to, imageDate: latest ? latest.date : null };
          await deps.store.saveSatellite(field.id, row, image);
          return row;
        })().finally(() => busy.delete(field.id));
        busy.set(field.id, job);
      }
      try {
        return { kind: "ok", row: await job };
      } catch (error) {
        if (cached && cached.boundaryKey === key) return { kind: "ok", row: cached, stale: true, error };
        return { kind: "failed", error };
      }
    },
  };
}

/** The field's boundary as [lon, lat] points, when it has one. */
export function boundaryRing(data: Record<string, unknown>): Array<[number, number]> | null {
  const b = Array.isArray(data.beacons) ? (data.beacons as Array<{ lat?: unknown; lon?: unknown }>) : [];
  const ring = b
    .map((p) => [Number(p.lon), Number(p.lat)] as [number, number])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180);
  return ring.length >= 3 ? ring : null;
}

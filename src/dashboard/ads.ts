import type { SupabaseClient } from "@supabase/supabase-js";
import { summariseAds, type AdLeadReader, type AdResult } from "../core/ads.js";
import { lagosMonth, type NumberLabel } from "./stats.js";

// Leads from WhatsApp ads on every number, ours and our clients' (AD_LEADS).

export interface AdsReport {
  ads: Array<AdResult & { label: string }>;
  /** Messages sent free inside ads' windows this month, all numbers together. */
  freeSentThisMonth: number;
}

export interface AdsSource {
  load(now: Date): Promise<AdsReport>;
}

export function createSupabaseAdsSource(db: SupabaseClient, reader: AdLeadReader, numbers: NumberLabel[]): AdsSource {
  return {
    async load(now) {
      const [leads, free, businesses] = await Promise.all([
        reader.leads(null, now),
        reader.freeSent(null, lagosMonth(now)),
        db.from("quote_businesses").select("phone_number_id, name").not("phone_number_id", "is", null),
      ]);
      const names = new Map((businesses.data ?? []).map((b) => [b.phone_number_id as string, b.name as string]));
      const mainId = numbers[0]?.id ?? "";
      const label = (id: string) => numbers.find((n) => n.id === (id || mainId))?.label ?? names.get(id) ?? `Number ${id}`;
      return {
        ads: summariseAds(leads, now).map((ad) => ({ ...ad, label: label(ad.numberId) })),
        freeSentThisMonth: [...free.values()].reduce((sum, n) => sum + n, 0),
      };
    },
  };
}

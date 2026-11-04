import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage } from "./whatsapp/types.js";

// Leads from WhatsApp ads (AD_LEADS, migration 0071). The first message
// someone sends after tapping a Click-to-WhatsApp ad carries the ad's details;
// it is saved per number, so every number (ours and our clients') gets its
// own leads. The database opens Meta's 72-hour free window when the first
// reply is saved, and counts messages inside it as free.

export interface AdLeadStore {
  /** Saves the ad behind this message. Saving the same message twice is a no-op. */
  record(contactId: string, msg: IncomingMessage & { referral: NonNullable<IncomingMessage["referral"]> }): Promise<void>;
}

export function createSupabaseAdLeads(db: SupabaseClient): AdLeadStore {
  return {
    async record(contactId, msg) {
      const r = msg.referral;
      const { error } = await db.from("ad_leads").upsert(
        {
          business_number_id: msg.businessNumberId ?? "",
          contact_id: contactId,
          wa_message_id: msg.waMessageId,
          source_type: r.sourceType,
          source_id: r.sourceId,
          source_url: r.sourceUrl ?? null,
          headline: r.headline ?? null,
          body: r.body ?? null,
          media_type: r.mediaType ?? null,
          ctwa_clid: r.ctwaClid ?? null,
          first_message_at: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
        },
        { onConflict: "wa_message_id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`saving the ad lead failed: ${error.message}`);
    },
  };
}

/** One saved ad lead, as the reports read it. */
export interface AdLead {
  numberId: string;
  contactId: string;
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
  headline: string | null;
  firstAt: Date;
  freeUntil: Date | null;
}

/** One ad's results on one number. */
export interface AdResult {
  numberId: string;
  sourceType: string;
  sourceId: string;
  /** The latest headline Meta sent for the ad; null when the ad has none. */
  headline: string | null;
  sourceUrl: string | null;
  /** Different people who messaged from the ad. */
  leads: number;
  leads7: number;
  leads30: number;
  /** People whose chat is inside the free window right now. */
  freeNow: number;
  lastAt: Date;
  /** When each person first messaged from this ad, by contact id. */
  firstBy: Map<string, Date>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Groups leads by number and ad, the busiest ad of the last 30 days first. */
export function summariseAds(leads: AdLead[], now: Date): AdResult[] {
  const ads = new Map<string, AdResult & { last7: Set<string>; last30: Set<string>; free: Set<string>; headlineAt: number }>();
  for (const l of leads) {
    const key = `${l.numberId}\u0000${l.sourceId}`;
    let ad = ads.get(key);
    if (!ad) {
      ad = {
        numberId: l.numberId,
        sourceType: l.sourceType,
        sourceId: l.sourceId,
        headline: null,
        sourceUrl: null,
        leads: 0,
        leads7: 0,
        leads30: 0,
        freeNow: 0,
        lastAt: l.firstAt,
        firstBy: new Map(),
        last7: new Set(),
        last30: new Set(),
        free: new Set(),
        headlineAt: 0,
      };
      ads.set(key, ad);
    }
    if (l.firstAt.getTime() >= ad.headlineAt) {
      ad.headline = l.headline ?? ad.headline;
      ad.sourceUrl = l.sourceUrl ?? ad.sourceUrl;
      ad.headlineAt = l.firstAt.getTime();
    }
    if (l.firstAt > ad.lastAt) ad.lastAt = l.firstAt;
    const first = ad.firstBy.get(l.contactId);
    if (!first || l.firstAt < first) ad.firstBy.set(l.contactId, l.firstAt);
    const age = now.getTime() - l.firstAt.getTime();
    if (age < 7 * DAY_MS) ad.last7.add(l.contactId);
    if (age < 30 * DAY_MS) ad.last30.add(l.contactId);
    if (l.freeUntil && l.freeUntil > now) ad.free.add(l.contactId);
  }
  return [...ads.values()]
    .map(({ last7, last30, free, headlineAt: _h, ...ad }) => ({
      ...ad,
      leads: ad.firstBy.size,
      leads7: last7.size,
      leads30: last30.size,
      freeNow: free.size,
    }))
    .sort((a, b) => b.leads30 - a.leads30 || b.lastAt.getTime() - a.lastAt.getTime());
}

/** How far back the reports look. */
export const AD_REPORT_DAYS = 90;

export interface AdLeadReader {
  /** Leads from the last AD_REPORT_DAYS days on these numbers, or on every number when `numberIds` is null. */
  leads(numberIds: string[] | null, now: Date): Promise<AdLead[]>;
  /** Messages each number sent free inside an ad's window this Lagos month (first day, YYYY-MM-DD). */
  freeSent(numberIds: string[] | null, month: string): Promise<Map<string, number>>;
}

export function createSupabaseAdLeadReader(db: SupabaseClient): AdLeadReader {
  return {
    async leads(numberIds, now) {
      const since = new Date(now.getTime() - AD_REPORT_DAYS * DAY_MS).toISOString();
      const out: AdLead[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        let query = db
          .from("ad_leads")
          .select("business_number_id, contact_id, source_type, source_id, source_url, headline, first_message_at, free_until")
          .gte("first_message_at", since);
        if (numberIds) query = query.in("business_number_id", numberIds);
        const { data, error } = await query.order("first_message_at").range(from, from + PAGE - 1);
        if (error) throw new Error(`reading ad leads failed: ${error.message}`);
        for (const r of data ?? []) {
          out.push({
            numberId: r.business_number_id as string,
            contactId: r.contact_id as string,
            sourceType: r.source_type as string,
            sourceId: r.source_id as string,
            sourceUrl: (r.source_url as string | null) ?? null,
            headline: (r.headline as string | null) ?? null,
            firstAt: new Date(r.first_message_at as string),
            freeUntil: r.free_until ? new Date(r.free_until as string) : null,
          });
        }
        if ((data ?? []).length < PAGE) return out;
      }
    },

    async freeSent(numberIds, month) {
      let query = db.from("whatsapp_sent_counts").select("business_number_id, free_sent").eq("month", month);
      if (numberIds) query = query.in("business_number_id", numberIds);
      const { data, error } = await query;
      if (error) throw new Error(`reading free messages failed: ${error.message}`);
      return new Map((data ?? []).map((r) => [r.business_number_id as string, Number(r.free_sent)]));
    },
  };
}

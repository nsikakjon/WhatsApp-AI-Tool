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

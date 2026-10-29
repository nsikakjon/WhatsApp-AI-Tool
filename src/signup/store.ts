import type { SupabaseClient } from "@supabase/supabase-js";

export interface Connection {
  phoneNumberId: string;
  wabaId: string;
  displayNumber?: string;
  verifiedName?: string;
  coexistence: boolean;
  businessToken: string;
}

export interface ConnectionStore {
  /** Saves a newly connected number, or updates it if it was connected before. */
  save(connection: Connection): Promise<void>;
}

export function createSupabaseConnectionStore(db: SupabaseClient): ConnectionStore {
  return {
    async save(c) {
      const { error } = await db.from("whatsapp_connections").upsert(
        {
          phone_number_id: c.phoneNumberId,
          waba_id: c.wabaId,
          display_number: c.displayNumber ?? null,
          verified_name: c.verifiedName ?? null,
          coexistence: c.coexistence,
          business_token: c.businessToken,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "phone_number_id" },
      );
      if (error) throw new Error(`Saving the connected number failed: ${error.message}`);
    },
  };
}

/**
 * Looks up the key a business gave us at sign-up for its number, so the bot
 * sends from that number with it. Kept for 10 minutes to spare the database.
 */
export function createConnectionTokens(db: SupabaseClient, now: () => number = Date.now) {
  const cache = new Map<string, { token?: string; at: number }>();
  return async (phoneNumberId: string): Promise<string | undefined> => {
    const hit = cache.get(phoneNumberId);
    if (hit && now() - hit.at < 10 * 60_000) return hit.token;
    const { data, error } = await db
      .from("whatsapp_connections")
      .select("business_token")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();
    // On a database hiccup, send with our own key rather than not at all.
    if (error) return hit?.token;
    const token = (data?.business_token as string | undefined) || undefined;
    cache.set(phoneNumberId, { token, at: now() });
    return token;
  };
}

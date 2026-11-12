import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountDirectory } from "../core/whatsapp/templates.js";

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

/** Every number connected on /signup with its account and key, for making its message templates. */
export function createConnectionDirectory(db: SupabaseClient): AccountDirectory {
  const read = async (phoneNumberId?: string) => {
    let q = db.from("whatsapp_connections").select("phone_number_id, waba_id, business_token");
    if (phoneNumberId) q = q.eq("phone_number_id", phoneNumberId);
    const { data, error } = await q;
    if (error) throw new Error(`Reading whatsapp_connections failed: ${error.message}`);
    return (data ?? []).map((r) => ({ phoneNumberId: r.phone_number_id as string, wabaId: r.waba_id as string, token: r.business_token as string }));
  };
  return { get: async (phoneNumberId) => (await read(phoneNumberId))[0] ?? null, list: () => read() };
}

/**
 * Looks up the key a business gave us at sign-up for its number, so the bot
 * sends from that number with it.
 */
export function createConnectionTokens(db: SupabaseClient, now: () => number = Date.now) {
  return connectionLookup(db, "business_token", now);
}

/** The WhatsApp Business Account a number connected on /signup belongs to. */
export function createConnectionAccounts(db: SupabaseClient, now: () => number = Date.now) {
  return connectionLookup(db, "waba_id", now);
}

// One column of a connected number's row, kept for 10 minutes to spare the database.
function connectionLookup(db: SupabaseClient, column: "business_token" | "waba_id", now: () => number) {
  const cache = new Map<string, { value?: string; at: number }>();
  return async (phoneNumberId: string): Promise<string | undefined> => {
    const hit = cache.get(phoneNumberId);
    if (hit && now() - hit.at < 10 * 60_000) return hit.value;
    const { data, error } = await db.from("whatsapp_connections").select(column).eq("phone_number_id", phoneNumberId).maybeSingle();
    // On a database hiccup, carry on with what we knew (for a key: send with our own rather than not at all).
    if (error) return hit?.value;
    const value = ((data as Record<string, unknown> | null)?.[column] as string | undefined) || undefined;
    cache.set(phoneNumberId, { value, at: now() });
    return value;
  };
}

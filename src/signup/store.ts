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

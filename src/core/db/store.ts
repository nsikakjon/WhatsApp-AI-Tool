import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingMessage } from "../whatsapp/types.js";

// Everything the core needs to save. Kept as an interface so tests can use an
// in-memory version instead of a real database.
export interface MessageStore {
  /** Creates the contact if new (or updates their name). Returns the contact's id. */
  upsertContact(waId: string, name?: string): Promise<string>;
  /**
   * Saves an incoming message. Returns "duplicate" if we've already saved a
   * message with this WhatsApp ID, which means Meta re-sent the webhook and we
   * must not reply again.
   */
  recordInbound(contactId: string, msg: IncomingMessage): Promise<"new" | "duplicate">;
  /** Saves a message we sent. */
  recordOutbound(
    contactId: string,
    out: { waMessageId: string; type: string; body: string; raw: unknown },
  ): Promise<void>;
}

// Postgres error code for "unique constraint violated".
const UNIQUE_VIOLATION = "23505";

export function createSupabaseStore(db: SupabaseClient): MessageStore {
  return {
    async upsertContact(waId, name) {
      const row: Record<string, unknown> = { wa_id: waId, updated_at: new Date().toISOString() };
      if (name) row.name = name;
      const { data, error } = await db
        .from("contacts")
        .upsert(row, { onConflict: "wa_id" })
        .select("id")
        .single();
      if (error) throw new Error(`upsertContact failed: ${error.message}`);
      return data.id as string;
    },

    async recordInbound(contactId, msg) {
      const { error } = await db.from("messages").insert({
        contact_id: contactId,
        direction: "inbound",
        wa_message_id: msg.waMessageId,
        type: msg.type,
        body: msg.text ?? null,
        raw: msg.raw,
      });
      if (!error) return "new";
      if (error.code === UNIQUE_VIOLATION) return "duplicate";
      throw new Error(`recordInbound failed: ${error.message}`);
    },

    async recordOutbound(contactId, out) {
      const { error } = await db.from("messages").insert({
        contact_id: contactId,
        direction: "outbound",
        wa_message_id: out.waMessageId || null,
        type: out.type,
        body: out.body,
        raw: out.raw,
      });
      if (error) throw new Error(`recordOutbound failed: ${error.message}`);
    },
  };
}

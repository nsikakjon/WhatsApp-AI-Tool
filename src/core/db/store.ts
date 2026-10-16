import type { SupabaseClient } from "@supabase/supabase-js";
import type { HistoryEntry } from "../product.js";
import type { IncomingMessage, OwnerReply } from "../whatsapp/types.js";

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
  /** Saves the text of an incoming message after the fact (e.g. a voice note's transcript). */
  setInboundText(waMessageId: string, text: string): Promise<void>;
  /** Saves a message we sent. */
  recordOutbound(
    contactId: string,
    out: { waMessageId: string; type: string; body: string; raw: unknown },
  ): Promise<void>;
  /**
   * The last `limit` text messages with this contact, oldest first. Excludes
   * the message with `excludeWaMessageId` (the one being handled right now).
   */
  recentHistory(contactId: string, limit: number, excludeWaMessageId?: string): Promise<HistoryEntry[]>;
  /**
   * When this person last messaged us, or null if never. WhatsApp only lets us
   * send them ordinary messages within 24 hours of that; after that, only
   * pre-approved template messages get through.
   */
  lastInboundAt(waId: string): Promise<Date | null>;
  /**
   * Saves a message the owner sent from the WhatsApp Business app. Returns
   * "duplicate" if we've already saved it (Meta re-sent the webhook, or it is
   * a copy of a message the bot itself sent).
   */
  recordOwnerReply(contactId: string, reply: OwnerReply): Promise<"new" | "duplicate">;
  /** Keeps the bot quiet in this chat (our number + customer) until `until`. */
  pauseChat(businessNumberId: string, waId: string, until: Date): Promise<void>;
  /** Until when the bot is quiet in this chat, or null if it never was. */
  chatPausedUntil(businessNumberId: string, waId: string): Promise<Date | null>;
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

    async setInboundText(waMessageId, text) {
      const { error } = await db.from("messages").update({ body: text }).eq("wa_message_id", waMessageId);
      if (error) throw new Error(`setInboundText failed: ${error.message}`);
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

    async recentHistory(contactId, limit, excludeWaMessageId) {
      const query = db
        .from("messages")
        .select("direction, body, wa_message_id")
        .eq("contact_id", contactId)
        .not("body", "is", null)
        .order("created_at", { ascending: false })
        .limit(limit + 1);
      const { data, error } = await query;
      if (error) throw new Error(`recentHistory failed: ${error.message}`);
      return (data ?? [])
        .filter((row) => row.wa_message_id !== excludeWaMessageId)
        .slice(0, limit)
        .reverse()
        .map((row) => ({ direction: row.direction as HistoryEntry["direction"], text: row.body as string }));
    },

    async lastInboundAt(waId) {
      const { data, error } = await db
        .from("messages")
        .select("created_at, contacts!inner(wa_id)")
        .eq("contacts.wa_id", waId)
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`lastInboundAt failed: ${error.message}`);
      return data ? new Date(data.created_at as string) : null;
    },

    async recordOwnerReply(contactId, reply) {
      // Stored like any other message we sent, so the bot sees what the owner
      // said when it picks the conversation back up.
      const { error } = await db.from("messages").insert({
        contact_id: contactId,
        direction: "outbound",
        wa_message_id: reply.waMessageId,
        type: reply.type,
        body: reply.text ?? null,
        raw: reply.raw,
      });
      if (!error) return "new";
      if (error.code === UNIQUE_VIOLATION) return "duplicate";
      throw new Error(`recordOwnerReply failed: ${error.message}`);
    },

    async pauseChat(businessNumberId, waId, until) {
      const { error } = await db.from("chat_pauses").upsert(
        {
          business_number_id: businessNumberId,
          wa_id: waId,
          paused_until: until.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_number_id,wa_id" },
      );
      if (error) throw new Error(`pauseChat failed: ${error.message}`);
    },

    async chatPausedUntil(businessNumberId, waId) {
      const { data, error } = await db
        .from("chat_pauses")
        .select("paused_until")
        .eq("business_number_id", businessNumberId)
        .eq("wa_id", waId)
        .maybeSingle();
      if (error) throw new Error(`chatPausedUntil failed: ${error.message}`);
      return data ? new Date(data.paused_until as string) : null;
    },
  };
}

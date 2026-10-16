import type { SupabaseClient } from "@supabase/supabase-js";

// What the staff inbox reads from the database. Kept as an interface so tests
// can use an in-memory version.

/** One chat: a customer talking to one of our WhatsApp numbers. */
export interface ChatSummary {
  contactId: string;
  /** Our number's Phone number ID, or null for messages saved before numbers were recorded. */
  businessNumberId: string | null;
  waId: string;
  name: string | null;
  lastDirection: "inbound" | "outbound";
  lastType: string;
  lastBody: string | null;
  lastAt: Date;
}

export interface ChatMessage {
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  /** True when a staff member sent it from the inbox (not the bot). */
  fromStaff: boolean;
  at: Date;
}

export interface InboxStore {
  /** The most recent chats, newest first. */
  listChats(limit: number): Promise<ChatSummary[]>;
  /** The customer behind a chat, or null if there's no such contact. */
  contact(contactId: string): Promise<{ waId: string; name: string | null } | null>;
  /**
   * The last `limit` messages of one chat, oldest first. `includeUnnumbered`
   * also takes messages saved before numbers were recorded (for the main number).
   */
  chatMessages(
    contactId: string,
    businessNumberId: string,
    includeUnnumbered: boolean,
    limit: number,
  ): Promise<ChatMessage[]>;
}

export function createSupabaseInboxStore(db: SupabaseClient): InboxStore {
  return {
    async listChats(limit) {
      const { data, error } = await db
        .from("inbox_chats")
        .select("contact_id, business_number_id, wa_id, name, last_direction, last_type, last_body, last_at")
        .order("last_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`listChats failed: ${error.message}`);
      return (data ?? []).map((row) => ({
        contactId: row.contact_id as string,
        businessNumberId: (row.business_number_id as string | null) ?? null,
        waId: row.wa_id as string,
        name: (row.name as string | null) ?? null,
        lastDirection: row.last_direction as ChatSummary["lastDirection"],
        lastType: row.last_type as string,
        lastBody: (row.last_body as string | null) ?? null,
        lastAt: new Date(row.last_at as string),
      }));
    },

    async contact(contactId) {
      const { data, error } = await db.from("contacts").select("wa_id, name").eq("id", contactId).maybeSingle();
      if (error) throw new Error(`contact failed: ${error.message}`);
      return data ? { waId: data.wa_id as string, name: (data.name as string | null) ?? null } : null;
    },

    async chatMessages(contactId, businessNumberId, includeUnnumbered, limit) {
      let query = db
        .from("messages")
        .select("direction, type, body, created_at, staff:raw->inbox")
        .eq("contact_id", contactId);
      query = includeUnnumbered
        ? query.or(`business_number_id.eq.${businessNumberId},business_number_id.is.null`)
        : query.eq("business_number_id", businessNumberId);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
      if (error) throw new Error(`chatMessages failed: ${error.message}`);
      return (data ?? []).reverse().map((row) => ({
        direction: row.direction as ChatMessage["direction"],
        type: row.type as string,
        body: (row.body as string | null) ?? null,
        fromStaff: row.staff === true,
        at: new Date(row.created_at as string),
      }));
    },
  };
}

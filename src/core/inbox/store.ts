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
  /** True when a person sent it, from the inbox or the WhatsApp Business app (not the bot). */
  fromStaff: boolean;
  at: Date;
  /** WhatsApp's id for the message, to find a file the customer sent with it. */
  waMessageId?: string;
}

export interface InboxStore {
  /**
   * The most recent chats, newest first. With `only`, just the chats on that
   * number (and, with includeUnnumbered, ones saved before numbers were recorded).
   */
  listChats(limit: number, only?: { numberId: string; includeUnnumbered: boolean; guestsOf?: string }): Promise<ChatSummary[]>;
  /** The customer behind a chat, or null if there's no such contact. */
  contact(contactId: string): Promise<{ waId: string; name: string | null } | null>;
  /**
   * The last `limit` messages of one chat, oldest first. `includeUnnumbered`
   * also takes messages saved before numbers were recorded (for the main number).
   * `guestsOf` (a shop on the yarnOga quotes line): only someone who sent its
   * keyword, from when they first did.
   */
  chatMessages(
    contactId: string,
    businessNumberId: string,
    includeUnnumbered: boolean,
    limit: number,
    guestsOf?: string,
  ): Promise<ChatMessage[]>;
}

export function createSupabaseInboxStore(db: SupabaseClient): InboxStore {
  /** People who sent a line shop's keyword, and when they first did (migration 0090). */
  async function guests(businessId: string): Promise<Map<string, string>> {
    const { data, error } = await db.from("quote_line_guests").select("wa_id, first_at").eq("business_id", businessId).limit(5000);
    if (error) throw new Error(`line guests failed: ${error.message}`);
    return new Map((data ?? []).map((r) => [r.wa_id as string, r.first_at as string]));
  }

  return {
    async listChats(limit, only) {
      let query = db
        .from("inbox_chats")
        .select("contact_id, business_number_id, wa_id, name, last_direction, last_type, last_body, last_at");
      if (only) {
        query = only.includeUnnumbered
          ? query.or(`business_number_id.eq.${only.numberId},business_number_id.is.null`)
          : query.eq("business_number_id", only.numberId);
        if (only.guestsOf) {
          const people = [...(await guests(only.guestsOf)).keys()];
          if (!people.length) return [];
          query = query.in("wa_id", people);
        }
      }
      const { data, error } = await query.order("last_at", { ascending: false }).limit(limit);
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

    async chatMessages(contactId, businessNumberId, includeUnnumbered, limit, guestsOf) {
      let since: string | undefined;
      if (guestsOf) {
        const { data: person, error: personError } = await db.from("contacts").select("wa_id").eq("id", contactId).maybeSingle();
        if (personError) throw new Error(`chatMessages contact failed: ${personError.message}`);
        since = person ? (await guests(guestsOf)).get(person.wa_id as string) : undefined;
        if (!since) return [];
      }
      let query = db
        .from("messages")
        .select("direction, type, body, created_at, wa_message_id, staff:raw->inbox, phone:raw->to")
        .eq("contact_id", contactId);
      query = includeUnnumbered
        ? query.or(`business_number_id.eq.${businessNumberId},business_number_id.is.null`)
        : query.eq("business_number_id", businessNumberId);
      if (since) query = query.gte("created_at", since);
      const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
      if (error) throw new Error(`chatMessages failed: ${error.message}`);
      return (data ?? []).reverse().map((row) => ({
        direction: row.direction as ChatMessage["direction"],
        type: row.type as string,
        body: (row.body as string | null) ?? null,
        // Inbox replies are marked { inbox: true }; replies from the Business
        // app arrive as echoes that name the customer in "to". The bot's own
        // messages carry neither.
        fromStaff: row.staff === true || (row.phone !== null && row.phone !== undefined),
        at: new Date(row.created_at as string),
        ...(row.wa_message_id ? { waMessageId: row.wa_message_id as string } : {}),
      }));
    },
  };
}

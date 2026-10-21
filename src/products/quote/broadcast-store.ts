import type { SupabaseClient } from "@supabase/supabase-js";

// Saving opt-ins and broadcasts (migration 0029). Kept behind an interface so
// tests can use an in-memory version instead of a real database.

export type OptInStatus = "in" | "out";

export interface Broadcast {
  id: number;
  businessId: string;
  businessName: string;
  fromNumberId: string | null;
  ownerWaId: string;
  body: string;
  imageMediaId: string | null;
  status: "draft" | "queued" | "done" | "cancelled";
  recipientCount: number;
}

export interface NewBroadcast {
  businessId: string;
  businessName: string;
  fromNumberId: string | null;
  ownerWaId: string;
  body: string;
  imageMediaId: string | null;
}

/** One person a queued broadcast still has to go to. */
export interface PendingRecipient {
  broadcastId: number;
  contactId: string;
  waId: string;
}

export type RecipientResult =
  | { status: "sent"; waMessageId: string }
  | { status: "failed"; error: string }
  | { status: "skipped" };

export interface BroadcastTally {
  sent: number;
  failed: number;
  skipped: number;
}

export interface BroadcastStore {
  optInStatus(businessId: string, contactId: string): Promise<OptInStatus | null>;
  setOptIn(
    businessId: string,
    contactId: string,
    status: OptInStatus,
    source: "keyword" | "button",
    waMessageId: string,
  ): Promise<void>;
  countOptedIn(businessId: string): Promise<number>;
  /** The add-on's monthly message limit, or null if the business doesn't have broadcasts. */
  monthlyLimit(businessId: string): Promise<number | null>;
  /** Messages sent or queued this month (Lagos time). */
  usedThisMonth(businessId: string): Promise<number>;
  createDraft(draft: NewBroadcast): Promise<Broadcast>;
  get(id: number): Promise<Broadcast | null>;
  /**
   * Confirms a draft: adds the opted-in customers (up to what's left of the
   * month's limit) and queues it, in one database step.
   */
  queue(id: number, monthlyLimit: number): Promise<{ outcome: "queued" | "not_draft" | "limit_reached"; recipients: number }>;
  /** Stops a draft or queued broadcast. Returns false if it had already finished or was cancelled. */
  cancel(id: number): Promise<boolean>;
  /** People still waiting for a queued broadcast, oldest first. */
  duePending(limit: number): Promise<PendingRecipient[]>;
  /** Marks one person as being sent to. False if another run already took them. */
  claim(r: PendingRecipient): Promise<boolean>;
  finishRecipient(r: PendingRecipient, result: RecipientResult): Promise<void>;
  /** If nobody is left waiting, marks the broadcast done and returns the tally. Otherwise null. */
  finishIfComplete(broadcastId: number): Promise<BroadcastTally | null>;
}

type BroadcastRow = {
  id: number | string;
  business_id: string;
  business_name: string;
  from_number_id: string | null;
  owner_wa_id: string;
  body: string;
  image_media_id: string | null;
  status: Broadcast["status"];
  recipient_count: number;
};

const COLUMNS = "id, business_id, business_name, from_number_id, owner_wa_id, body, image_media_id, status, recipient_count";

function toBroadcast(row: BroadcastRow): Broadcast {
  return {
    id: Number(row.id),
    businessId: row.business_id,
    businessName: row.business_name,
    fromNumberId: row.from_number_id,
    ownerWaId: row.owner_wa_id,
    body: row.body,
    imageMediaId: row.image_media_id,
    status: row.status,
    recipientCount: row.recipient_count,
  };
}

export function createSupabaseBroadcasts(db: SupabaseClient): BroadcastStore {
  const fail = (what: string, error: { message: string }) => new Error(`${what} failed: ${error.message}`);

  return {
    async optInStatus(businessId, contactId) {
      const { data, error } = await db
        .from("broadcast_optins")
        .select("status")
        .eq("business_id", businessId)
        .eq("contact_id", contactId)
        .maybeSingle();
      if (error) throw fail("optInStatus", error);
      return (data?.status as OptInStatus | undefined) ?? null;
    },

    async setOptIn(businessId, contactId, status, source, waMessageId) {
      const now = new Date().toISOString();
      const { error } = await db.from("broadcast_optins").upsert({
        business_id: businessId,
        contact_id: contactId,
        status,
        source,
        wa_message_id: waMessageId,
        updated_at: now,
        ...(status === "in" ? { opted_in_at: now } : { opted_out_at: now }),
      });
      if (error) throw fail("setOptIn", error);
    },

    async countOptedIn(businessId) {
      const { count, error } = await db
        .from("broadcast_optins")
        .select("contact_id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("status", "in");
      if (error) throw fail("countOptedIn", error);
      return count ?? 0;
    },

    async monthlyLimit(businessId) {
      const { data, error } = await db
        .from("broadcast_addons")
        .select("monthly_limit, active")
        .eq("business_id", businessId)
        .maybeSingle();
      if (error) throw fail("monthlyLimit", error);
      return data && data.active ? Number(data.monthly_limit) : null;
    },

    async usedThisMonth(businessId) {
      const { data, error } = await db.rpc("broadcast_used_this_month", { p_business_id: businessId });
      if (error) throw fail("usedThisMonth", error);
      return Number(data ?? 0);
    },

    async createDraft(d) {
      const { data, error } = await db
        .from("broadcasts")
        .insert({
          business_id: d.businessId,
          business_name: d.businessName,
          from_number_id: d.fromNumberId,
          owner_wa_id: d.ownerWaId,
          body: d.body,
          image_media_id: d.imageMediaId,
        })
        .select(COLUMNS)
        .single();
      if (error) throw fail("createDraft", error);
      return toBroadcast(data as BroadcastRow);
    },

    async get(id) {
      const { data, error } = await db.from("broadcasts").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw fail("get broadcast", error);
      return data ? toBroadcast(data as BroadcastRow) : null;
    },

    async queue(id, monthlyLimit) {
      const { data, error } = await db.rpc("broadcast_queue", { p_broadcast_id: id, p_monthly_limit: monthlyLimit });
      if (error) throw fail("queue broadcast", error);
      const row = (data as Array<{ outcome: string; recipients: number }> | null)?.[0];
      return {
        outcome: (row?.outcome ?? "not_draft") as "queued" | "not_draft" | "limit_reached",
        recipients: Number(row?.recipients ?? 0),
      };
    },

    async cancel(id) {
      const now = new Date().toISOString();
      const { data, error } = await db
        .from("broadcasts")
        .update({ status: "cancelled", finished_at: now })
        .eq("id", id)
        .in("status", ["draft", "queued"])
        .select("id");
      if (error) throw fail("cancel broadcast", error);
      if ((data ?? []).length === 0) return false;
      const { error: skipError } = await db
        .from("broadcast_recipients")
        .update({ status: "skipped" })
        .eq("broadcast_id", id)
        .eq("status", "pending");
      if (skipError) throw fail("skip cancelled recipients", skipError);
      return true;
    },

    async duePending(limit) {
      const { data, error } = await db
        .from("broadcast_recipients")
        .select("broadcast_id, contact_id, wa_id, broadcasts!inner(status)")
        .eq("status", "pending")
        .eq("broadcasts.status", "queued")
        .order("created_at")
        .limit(limit);
      if (error) throw fail("duePending", error);
      return (data ?? []).map((r) => ({
        broadcastId: Number(r.broadcast_id),
        contactId: r.contact_id as string,
        waId: r.wa_id as string,
      }));
    },

    async claim(r) {
      const { data, error } = await db
        .from("broadcast_recipients")
        .update({ status: "sending" })
        .eq("broadcast_id", r.broadcastId)
        .eq("contact_id", r.contactId)
        .eq("status", "pending")
        .select("contact_id");
      if (error) throw fail("claim recipient", error);
      return (data ?? []).length > 0;
    },

    async finishRecipient(r, result) {
      const update: Record<string, unknown> = { status: result.status };
      if (result.status === "sent") {
        update.wa_message_id = result.waMessageId;
        update.sent_at = new Date().toISOString();
      }
      if (result.status === "failed") update.error = result.error.slice(0, 500);
      const { error } = await db
        .from("broadcast_recipients")
        .update(update)
        .eq("broadcast_id", r.broadcastId)
        .eq("contact_id", r.contactId);
      if (error) throw fail("finishRecipient", error);
    },

    async finishIfComplete(broadcastId) {
      const { count, error } = await db
        .from("broadcast_recipients")
        .select("contact_id", { count: "exact", head: true })
        .eq("broadcast_id", broadcastId)
        .in("status", ["pending", "sending"]);
      if (error) throw fail("finishIfComplete", error);
      if ((count ?? 0) > 0) return null;

      const { data: done, error: doneError } = await db
        .from("broadcasts")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", broadcastId)
        .eq("status", "queued")
        .select("id");
      if (doneError) throw fail("finish broadcast", doneError);
      if ((done ?? []).length === 0) return null;

      const { data: rows, error: tallyError } = await db
        .from("broadcast_recipients")
        .select("status")
        .eq("broadcast_id", broadcastId);
      if (tallyError) throw fail("tally broadcast", tallyError);
      const tally: BroadcastTally = { sent: 0, failed: 0, skipped: 0 };
      for (const row of rows ?? []) {
        const s = row.status as string;
        if (s === "sent" || s === "failed" || s === "skipped") tally[s]++;
      }
      return tally;
    },
  };
}

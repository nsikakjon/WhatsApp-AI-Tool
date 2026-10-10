import type { SupabaseClient } from "@supabase/supabase-js";

// Reading sites and teams, and saving updates, photos and reports. Kept behind
// an interface so tests can use an in-memory version instead of a real database.

export interface Member {
  id: string;
  name: string;
  role: "staff" | "manager";
  siteId: string;
  siteName: string;
}

export type UpdateKind = "text" | "photo" | "voice";

export interface SiteUpdate {
  memberName: string;
  kind: UpdateKind;
  body: string | null;
  createdAt: Date;
}

export interface SiteWithManagers {
  siteId: string;
  siteName: string;
  /** WhatsApp numbers of the site's managers, who get the daily report. */
  managers: string[];
}

export interface SiteStore {
  /** The active team member with this WhatsApp number on an active site, or null. */
  findMember(waId: string): Promise<Member | null>;
  /** This member's most recent update, used to avoid replying to every photo in a batch. */
  lastUpdate(memberId: string): Promise<{ kind: UpdateKind; createdAt: Date } | null>;
  /** Saves a photo to storage and returns where it was saved. */
  savePhoto(siteId: string, waMessageId: string, photo: { data: Blob; mimeType: string }): Promise<string>;
  /** Logs an update. Returns "duplicate" if this WhatsApp message was already logged. */
  addUpdate(update: {
    siteId: string;
    memberId: string;
    waMessageId: string;
    kind: UpdateKind;
    body: string | null;
    photoPath: string | null;
  }): Promise<"new" | "duplicate">;
  /** Every update for a site between two moments, oldest first. */
  updatesBetween(siteId: string, from: Date, to: Date): Promise<SiteUpdate[]>;
  /** Active sites that have at least one active manager. */
  sitesWithManagers(): Promise<SiteWithManagers[]>;
  /** True if the daily report for this site and day has already been sent. */
  hasReport(siteId: string, reportDate: string): Promise<boolean>;
  /**
   * Records the daily report. Returns false if one was already recorded for
   * this site and day, in which case it must not be sent again.
   */
  claimReport(siteId: string, reportDate: string, body: string): Promise<boolean>;
}

const UNIQUE_VIOLATION = "23505";
const PHOTO_BUCKET = "site-photos";

export function createSupabaseSiteStore(db: SupabaseClient): SiteStore {
  return {
    async findMember(waId) {
      const { data, error } = await db
        .from("site_members")
        .select("id, name, role, site_id, site_sites!inner(name, active)")
        .eq("wa_id", waId)
        .eq("active", true)
        .eq("site_sites.active", true)
        .maybeSingle();
      if (error) throw new Error(`findMember failed: ${error.message}`);
      if (!data) return null;
      const site = data.site_sites as unknown as { name: string };
      return {
        id: data.id as string,
        name: data.name as string,
        role: data.role as Member["role"],
        siteId: data.site_id as string,
        siteName: site.name,
      };
    },

    async lastUpdate(memberId) {
      const { data, error } = await db
        .from("site_updates")
        .select("kind, created_at")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`lastUpdate failed: ${error.message}`);
      return data ? { kind: data.kind as UpdateKind, createdAt: new Date(data.created_at as string) } : null;
    },

    async savePhoto(siteId, waMessageId, photo) {
      const ext = photo.mimeType.includes("png") ? "png" : photo.mimeType.includes("webp") ? "webp" : "jpg";
      const day = new Date().toISOString().slice(0, 10);
      const path = `${siteId}/${day}/${waMessageId.replace(/[^\w.-]/g, "_")}.${ext}`;
      const { error } = await db.storage
        .from(PHOTO_BUCKET)
        .upload(path, photo.data, { contentType: photo.mimeType, upsert: true });
      if (error) throw new Error(`savePhoto failed: ${error.message}`);
      return path;
    },

    async addUpdate(u) {
      const { error } = await db.from("site_updates").insert({
        site_id: u.siteId,
        member_id: u.memberId,
        wa_message_id: u.waMessageId,
        kind: u.kind,
        body: u.body,
        photo_path: u.photoPath,
      });
      if (!error) return "new";
      if (error.code === UNIQUE_VIOLATION) return "duplicate";
      throw new Error(`addUpdate failed: ${error.message}`);
    },

    async updatesBetween(siteId, from, to) {
      const { data, error } = await db
        .from("site_updates")
        .select("kind, body, created_at, site_members(name)")
        .eq("site_id", siteId)
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at", { ascending: true });
      if (error) throw new Error(`updatesBetween failed: ${error.message}`);
      return (data ?? []).map((row) => ({
        memberName: (row.site_members as unknown as { name: string } | null)?.name ?? "Someone",
        kind: row.kind as UpdateKind,
        body: row.body as string | null,
        createdAt: new Date(row.created_at as string),
      }));
    },

    async sitesWithManagers() {
      const { data, error } = await db
        .from("site_sites")
        .select("id, name, site_members!inner(wa_id, role, active)")
        .eq("active", true)
        .eq("site_members.role", "manager")
        .eq("site_members.active", true);
      if (error) throw new Error(`sitesWithManagers failed: ${error.message}`);
      return (data ?? []).map((row) => ({
        siteId: row.id as string,
        siteName: row.name as string,
        managers: (row.site_members as unknown as Array<{ wa_id: string }>).map((m) => m.wa_id),
      }));
    },

    async hasReport(siteId, reportDate) {
      const { data, error } = await db
        .from("site_reports")
        .select("id")
        .eq("site_id", siteId)
        .eq("report_date", reportDate)
        .maybeSingle();
      if (error) throw new Error(`hasReport failed: ${error.message}`);
      return data !== null;
    },

    async claimReport(siteId, reportDate, body) {
      const { error } = await db.from("site_reports").insert({ site_id: siteId, report_date: reportDate, body });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`claimReport failed: ${error.message}`);
    },
  };
}

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Where Oko keeps its users, logins, invites, fields and photos (migration
// 0076). Kept behind an interface so tests use an in-memory version.

export type FarmRole = "admin" | "tester";

export interface FarmUser {
  id: string;
  name: string;
  role: FarmRole;
  disabled: boolean;
  createdAt: Date;
  lastSeen: Date | null;
  /** Their WhatsApp number (digits with the country code, e.g. 2348031234567), for alerts. */
  phone: string | null;
}

export interface FarmInvite {
  kind: "app" | "field";
  fieldId: string | null;
  nameHint: string | null;
  createdBy: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface FieldRow {
  id: string;
  ownerId: string;
  data: Record<string, unknown>;
  version: number;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
}

export interface SatelliteRow {
  boundaryKey: string;
  series: Array<{ date: string; mean: number; min: number; max: number; clear: number }>;
  fetchedAt: Date;
  imageDate: string | null;
}

export interface FarmStore {
  user(id: string): Promise<FarmUser | null>;
  createUser(name: string, role: FarmRole): Promise<FarmUser>;
  /** Jay's account, made the first time he logs in. */
  admin(): Promise<FarmUser>;
  users(): Promise<FarmUser[]>;
  seen(userId: string): Promise<void>;
  setDisabled(userId: string, disabled: boolean): Promise<void>;

  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  /** The logged-in user, or null when the login is unknown, expired or switched off. */
  sessionUser(tokenHash: string, now?: Date): Promise<FarmUser | null>;
  deleteSession(tokenHash: string): Promise<void>;

  createInvite(tokenHash: string, invite: Omit<FarmInvite, "usedAt">): Promise<void>;
  /** The invite if it can still be used (not used, not expired). */
  invite(tokenHash: string, now?: Date): Promise<FarmInvite | null>;
  /** Marks it used; false if someone used it first. */
  useInvite(tokenHash: string, userId: string, now?: Date): Promise<boolean>;

  field(id: string): Promise<FieldRow | null>;
  /** Fields the user owns or helps on (every field for the admin), changed after `since`. */
  fieldsFor(user: FarmUser, since: Date | null): Promise<FieldRow[]>;
  /** Ids of every field the user can open right now. */
  accessible(user: FarmUser): Promise<string[]>;
  /** Writes a new version if the field is still at `expected` (0 for a new field). */
  writeField(id: string, ownerId: string, data: Record<string, unknown>, expected: number, by: string): Promise<FieldRow | null>;
  deleteField(id: string, by: string): Promise<void>;
  /** Bumps the field so everyone's next sync picks it up (e.g. after a helper joins). */
  touchField(id: string): Promise<void>;

  members(fieldId: string): Promise<Array<{ userId: string; name: string }>>;
  isMember(fieldId: string, userId: string): Promise<boolean>;
  addMember(fieldId: string, userId: string): Promise<void>;
  removeMember(fieldId: string, userId: string): Promise<void>;
  /** How many fields each user owns. */
  fieldCounts(): Promise<Map<string, number>>;

  savePhoto(fieldId: string, data: Uint8Array, mimeType: string, by: string): Promise<string>;
  photo(id: string): Promise<{ fieldId: string; data: Uint8Array; mimeType: string } | null>;

  /** The last satellite results for a field (migration 0077). */
  satellite(fieldId: string): Promise<SatelliteRow | null>;
  /** Saves new results; `image` replaces the field's picture when given. */
  saveSatellite(fieldId: string, row: SatelliteRow, image: Uint8Array | null): Promise<void>;
  satelliteImage(fieldId: string): Promise<Uint8Array | null>;

  /* WhatsApp alerts (migration 0078) */
  setPhone(userId: string, phone: string | null): Promise<void>;
  /** The fields a user owns, with their alerts switch. */
  alertSwitches(ownerId: string): Promise<Array<{ id: string; name: string | null; on: boolean }>>;
  setAlertSwitch(fieldId: string, on: boolean): Promise<void>;
  /** Ids of every field (not deleted) with alerts switched on. */
  alertFieldIds(): Promise<string[]>;
  /** Alerts sent for a field since `since` (their keys). */
  sentAlerts(fieldId: string, since: Date): Promise<string[]>;
  recordSentAlerts(fieldId: string, keys: string[], to: string, at?: Date): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* In memory (tests)                                                   */
/* ------------------------------------------------------------------ */

export function memoryFarmStore(): FarmStore & { _fields: Map<string, FieldRow> } {
  const users = new Map<string, FarmUser>();
  const sessions = new Map<string, { userId: string; expiresAt: Date }>();
  const invites = new Map<string, FarmInvite>();
  const fields = new Map<string, FieldRow>();
  const members = new Map<string, Set<string>>();
  const photos = new Map<string, { fieldId: string; data: Uint8Array; mimeType: string }>();
  const sats = new Map<string, { row: SatelliteRow; image: Uint8Array | null }>();
  const alertsOn = new Set<string>();
  const sent: Array<{ fieldId: string; key: string; to: string; at: Date }> = [];
  let clock = 0;
  const tick = () => new Date(Date.now() + ++clock);

  const store: FarmStore & { _fields: Map<string, FieldRow> } = {
    _fields: fields,
    async user(id) { return users.get(id) ?? null; },
    async createUser(name, role) {
      const u: FarmUser = { id: randomUUID(), name, role, disabled: false, createdAt: new Date(), lastSeen: null, phone: null };
      users.set(u.id, u);
      return u;
    },
    async admin() {
      return [...users.values()].find((u) => u.role === "admin") ?? store.createUser("Jay", "admin");
    },
    async users() { return [...users.values()]; },
    async seen(id) { const u = users.get(id); if (u) u.lastSeen = new Date(); },
    async setDisabled(id, d) { const u = users.get(id); if (u) u.disabled = d; },
    async createSession(h, userId, expiresAt) { sessions.set(h, { userId, expiresAt }); },
    async sessionUser(h, now = new Date()) {
      const s = sessions.get(h);
      if (!s || s.expiresAt <= now) return null;
      const u = users.get(s.userId);
      return u && !u.disabled ? u : null;
    },
    async deleteSession(h) { sessions.delete(h); },
    async createInvite(h, inv) { invites.set(h, { ...inv, usedAt: null }); },
    async invite(h, now = new Date()) {
      const i = invites.get(h);
      return i && !i.usedAt && i.expiresAt > now ? i : null;
    },
    async useInvite(h, _userId, now = new Date()) {
      const i = invites.get(h);
      if (!i || i.usedAt) return false;
      i.usedAt = now;
      return true;
    },
    async field(id) { return fields.get(id) ?? null; },
    async fieldsFor(user, since) {
      const ids = new Set(await store.accessible(user));
      return [...fields.values()].filter((f) => (user.role === "admin" || ids.has(f.id) || f.ownerId === user.id || members.get(f.id)?.has(user.id)) && (!since || f.updatedAt > since));
    },
    async accessible(user) {
      return [...fields.values()].filter((f) => !f.deletedAt && (user.role === "admin" || f.ownerId === user.id || members.get(f.id)?.has(user.id))).map((f) => f.id);
    },
    async writeField(id, ownerId, data, expected, by) {
      const cur = fields.get(id);
      if ((cur?.version ?? 0) !== expected) return null;
      const row: FieldRow = { id, ownerId: cur?.ownerId ?? ownerId, data, version: expected + 1, updatedAt: tick(), updatedBy: by, deletedAt: cur?.deletedAt ?? null };
      fields.set(id, row);
      return row;
    },
    async deleteField(id, by) { const f = fields.get(id); if (f) { f.deletedAt = new Date(); f.updatedAt = tick(); f.updatedBy = by; } },
    async touchField(id) { const f = fields.get(id); if (f) f.updatedAt = tick(); },
    async members(fieldId) { return [...(members.get(fieldId) ?? [])].map((userId) => ({ userId, name: users.get(userId)?.name ?? "?" })); },
    async isMember(fieldId, userId) { return members.get(fieldId)?.has(userId) ?? false; },
    async addMember(fieldId, userId) { if (!members.has(fieldId)) members.set(fieldId, new Set()); members.get(fieldId)!.add(userId); },
    async removeMember(fieldId, userId) { members.get(fieldId)?.delete(userId); },
    async fieldCounts() {
      const m = new Map<string, number>();
      for (const f of fields.values()) if (!f.deletedAt) m.set(f.ownerId, (m.get(f.ownerId) ?? 0) + 1);
      return m;
    },
    async savePhoto(fieldId, data, mimeType) { const id = randomUUID(); photos.set(id, { fieldId, data, mimeType }); return id; },
    async photo(id) { return photos.get(id) ?? null; },
    async satellite(fieldId) { return sats.get(fieldId)?.row ?? null; },
    async saveSatellite(fieldId, row, image) { sats.set(fieldId, { row, image: image ?? sats.get(fieldId)?.image ?? null }); },
    async satelliteImage(fieldId) { return sats.get(fieldId)?.image ?? null; },
    async setPhone(id, phone) { const u = users.get(id); if (u) u.phone = phone; },
    async alertSwitches(ownerId) {
      return [...fields.values()]
        .filter((f) => f.ownerId === ownerId && !f.deletedAt)
        .map((f) => ({ id: f.id, name: typeof (f.data.f as { name?: unknown })?.name === "string" ? ((f.data.f as { name: string }).name) : null, on: alertsOn.has(f.id) }));
    },
    async setAlertSwitch(fieldId, on) { if (on) alertsOn.add(fieldId); else alertsOn.delete(fieldId); },
    async alertFieldIds() { return [...alertsOn].filter((id) => fields.has(id) && !fields.get(id)!.deletedAt); },
    async sentAlerts(fieldId, since) { return sent.filter((x) => x.fieldId === fieldId && x.at >= since).map((x) => x.key); },
    async recordSentAlerts(fieldId, keys, to, at = new Date()) { for (const key of keys) sent.push({ fieldId, key, to, at }); },
  };
  return store;
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */

const BUCKET = "farm-photos";

type UserRow = { id: string; name: string; role: FarmRole; disabled: boolean; created_at: string; last_seen: string | null; phone: string | null };
type FieldDb = { id: string; owner_id: string; data: Record<string, unknown>; version: number; updated_at: string; updated_by: string | null; deleted_at: string | null };

const toUser = (r: UserRow): FarmUser => ({ id: r.id, name: r.name, role: r.role, disabled: r.disabled, createdAt: new Date(r.created_at), lastSeen: r.last_seen ? new Date(r.last_seen) : null, phone: r.phone ?? null });
const toField = (r: FieldDb): FieldRow => ({ id: r.id, ownerId: r.owner_id, data: r.data, version: r.version, updatedAt: new Date(r.updated_at), updatedBy: r.updated_by, deletedAt: r.deleted_at ? new Date(r.deleted_at) : null });
const USER_COLS = "id,name,role,disabled,created_at,last_seen,phone";
const FIELD_COLS = "id,owner_id,data,version,updated_at,updated_by,deleted_at";

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Farm ${what} failed: ${res.error.message}`);
  return res.data;
}

export function createSupabaseFarmStore(db: SupabaseClient): FarmStore {
  const store: FarmStore = {
    async user(id) {
      const r = check(await db.from("farm_users").select(USER_COLS).eq("id", id).maybeSingle(), "user");
      return r ? toUser(r as UserRow) : null;
    },
    async createUser(name, role) {
      return toUser(check(await db.from("farm_users").insert({ name, role }).select(USER_COLS).single(), "create user") as UserRow);
    },
    async admin() {
      const r = check(await db.from("farm_users").select(USER_COLS).eq("role", "admin").maybeSingle(), "admin");
      if (r) return toUser(r as UserRow);
      try {
        return await store.createUser("Jay", "admin");
      } catch {
        // Two first logins at once: the other one made it.
        return toUser(check(await db.from("farm_users").select(USER_COLS).eq("role", "admin").single(), "admin") as UserRow);
      }
    },
    async users() {
      return (check(await db.from("farm_users").select(USER_COLS).order("created_at"), "users") as UserRow[]).map(toUser);
    },
    async seen(id) { check(await db.from("farm_users").update({ last_seen: new Date().toISOString() }).eq("id", id), "seen"); },
    async setDisabled(id, disabled) { check(await db.from("farm_users").update({ disabled }).eq("id", id), "disable"); },

    async createSession(h, userId, expiresAt) {
      check(await db.from("farm_sessions").insert({ token_hash: h, user_id: userId, expires_at: expiresAt.toISOString() }), "create session");
    },
    async sessionUser(h, now = new Date()) {
      const r = check(await db.from("farm_sessions").select("expires_at, farm_users(" + USER_COLS + ")").eq("token_hash", h).maybeSingle(), "session") as unknown as
        | { expires_at: string; farm_users: UserRow | null }
        | null;
      if (!r || !r.farm_users || new Date(r.expires_at) <= now) return null;
      const u = toUser(r.farm_users);
      return u.disabled ? null : u;
    },
    async deleteSession(h) { check(await db.from("farm_sessions").delete().eq("token_hash", h), "logout"); },

    async createInvite(h, i) {
      check(await db.from("farm_invites").insert({ token_hash: h, kind: i.kind, field_id: i.fieldId, name_hint: i.nameHint, created_by: i.createdBy, expires_at: i.expiresAt.toISOString() }), "create invite");
    },
    async invite(h, now = new Date()) {
      const r = check(await db.from("farm_invites").select("kind,field_id,name_hint,created_by,expires_at,used_at").eq("token_hash", h).maybeSingle(), "invite") as
        | { kind: "app" | "field"; field_id: string | null; name_hint: string | null; created_by: string; expires_at: string; used_at: string | null }
        | null;
      if (!r || r.used_at || new Date(r.expires_at) <= now) return null;
      return { kind: r.kind, fieldId: r.field_id, nameHint: r.name_hint, createdBy: r.created_by, expiresAt: new Date(r.expires_at), usedAt: null };
    },
    async useInvite(h, userId, now = new Date()) {
      const r = check(await db.from("farm_invites").update({ used_at: now.toISOString(), used_by: userId }).eq("token_hash", h).is("used_at", null).select("token_hash"), "use invite") as unknown[];
      return r.length === 1;
    },

    async field(id) {
      const r = check(await db.from("farm_fields").select(FIELD_COLS).eq("id", id).maybeSingle(), "field");
      return r ? toField(r as FieldDb) : null;
    },
    async fieldsFor(user, since) {
      let q = db.from("farm_fields").select(FIELD_COLS);
      if (user.role !== "admin") {
        const helps = (check(await db.from("farm_members").select("field_id").eq("user_id", user.id), "memberships") as Array<{ field_id: string }>).map((m) => m.field_id);
        q = helps.length ? q.or(`owner_id.eq.${user.id},id.in.(${helps.map((x) => `"${x}"`).join(",")})`) : q.eq("owner_id", user.id);
      }
      if (since) q = q.gt("updated_at", since.toISOString());
      return (check(await q.order("updated_at"), "fields") as FieldDb[]).map(toField);
    },
    async accessible(user) {
      let q = db.from("farm_fields").select("id").is("deleted_at", null);
      if (user.role !== "admin") {
        const helps = (check(await db.from("farm_members").select("field_id").eq("user_id", user.id), "memberships") as Array<{ field_id: string }>).map((m) => m.field_id);
        q = helps.length ? q.or(`owner_id.eq.${user.id},id.in.(${helps.map((x) => `"${x}"`).join(",")})`) : q.eq("owner_id", user.id);
      }
      return (check(await q, "accessible") as Array<{ id: string }>).map((r) => r.id);
    },
    async writeField(id, ownerId, data, expected, by) {
      const now = new Date().toISOString();
      if (expected === 0) {
        const r = await db.from("farm_fields").insert({ id, owner_id: ownerId, data, version: 1, updated_at: now, updated_by: by }).select(FIELD_COLS).maybeSingle();
        if (r.error) {
          if (/duplicate|unique/i.test(r.error.message)) return null;
          throw new Error(`Farm save field failed: ${r.error.message}`);
        }
        return r.data ? toField(r.data as FieldDb) : null;
      }
      const r = check(await db.from("farm_fields").update({ data, version: expected + 1, updated_at: now, updated_by: by }).eq("id", id).eq("version", expected).select(FIELD_COLS), "save field") as FieldDb[];
      return r[0] ? toField(r[0]) : null;
    },
    async deleteField(id, by) {
      const now = new Date().toISOString();
      check(await db.from("farm_fields").update({ deleted_at: now, updated_at: now, updated_by: by }).eq("id", id), "delete field");
    },
    async touchField(id) { check(await db.from("farm_fields").update({ updated_at: new Date().toISOString() }).eq("id", id), "touch field"); },

    async members(fieldId) {
      const r = check(await db.from("farm_members").select("user_id, farm_users(name)").eq("field_id", fieldId), "members") as unknown as Array<{ user_id: string; farm_users: { name: string } | null }>;
      return r.map((m) => ({ userId: m.user_id, name: m.farm_users?.name ?? "?" }));
    },
    async isMember(fieldId, userId) {
      const r = check(await db.from("farm_members").select("user_id").eq("field_id", fieldId).eq("user_id", userId).maybeSingle(), "is member");
      return !!r;
    },
    async addMember(fieldId, userId) {
      check(await db.from("farm_members").upsert({ field_id: fieldId, user_id: userId }, { onConflict: "field_id,user_id", ignoreDuplicates: true }), "add member");
    },
    async removeMember(fieldId, userId) { check(await db.from("farm_members").delete().eq("field_id", fieldId).eq("user_id", userId), "remove member"); },
    async fieldCounts() {
      const r = check(await db.from("farm_fields").select("owner_id").is("deleted_at", null), "counts") as Array<{ owner_id: string }>;
      const m = new Map<string, number>();
      for (const x of r) m.set(x.owner_id, (m.get(x.owner_id) ?? 0) + 1);
      return m;
    },

    async savePhoto(fieldId, data, mimeType, by) {
      const id = randomUUID();
      const path = `${fieldId}/${id}.${mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg"}`;
      const up = await db.storage.from(BUCKET).upload(path, data, { contentType: mimeType, upsert: false });
      if (up.error) throw new Error(`Farm photo upload failed: ${up.error.message}`);
      check(await db.from("farm_photos").insert({ id, field_id: fieldId, path, mime_type: mimeType, size_bytes: data.byteLength, uploaded_by: by }), "photo row");
      return id;
    },
    async photo(id) {
      const r = check(await db.from("farm_photos").select("field_id,path,mime_type").eq("id", id).maybeSingle(), "photo") as { field_id: string; path: string; mime_type: string } | null;
      if (!r) return null;
      const file = await db.storage.from(BUCKET).download(r.path);
      if (file.error || !file.data) return null;
      return { fieldId: r.field_id, data: new Uint8Array(await file.data.arrayBuffer()), mimeType: r.mime_type };
    },

    async satellite(fieldId) {
      const r = check(await db.from("farm_satellite").select("boundary_key,series,fetched_at,image_date").eq("field_id", fieldId).maybeSingle(), "satellite") as
        | { boundary_key: string; series: SatelliteRow["series"]; fetched_at: string; image_date: string | null }
        | null;
      return r ? { boundaryKey: r.boundary_key, series: r.series ?? [], fetchedAt: new Date(r.fetched_at), imageDate: r.image_date } : null;
    },
    async saveSatellite(fieldId, row, image) {
      const path = `${fieldId}/satellite.png`;
      if (image) {
        const up = await db.storage.from(BUCKET).upload(path, image, { contentType: "image/png", upsert: true });
        if (up.error) throw new Error(`Farm satellite picture upload failed: ${up.error.message}`);
      }
      const values: Record<string, unknown> = { field_id: fieldId, boundary_key: row.boundaryKey, series: row.series, fetched_at: row.fetchedAt.toISOString(), image_date: row.imageDate };
      if (image) values.image_path = path;
      check(await db.from("farm_satellite").upsert(values, { onConflict: "field_id" }), "save satellite");
    },
    async satelliteImage(fieldId) {
      const r = check(await db.from("farm_satellite").select("image_path").eq("field_id", fieldId).maybeSingle(), "satellite picture") as { image_path: string | null } | null;
      if (!r?.image_path) return null;
      const file = await db.storage.from(BUCKET).download(r.image_path);
      return file.error || !file.data ? null : new Uint8Array(await file.data.arrayBuffer());
    },

    // The alerts columns are only read here, so the rest of the app keeps
    // working before migration 0078 is run.
    async setPhone(id, phone) { check(await db.from("farm_users").update({ phone }).eq("id", id), "save phone"); },
    async alertSwitches(ownerId) {
      const r = check(await db.from("farm_fields").select("id,name:data->f->>name,whatsapp_alerts").eq("owner_id", ownerId).is("deleted_at", null).order("updated_at"), "alert switches") as unknown as
        Array<{ id: string; name: string | null; whatsapp_alerts: boolean }>;
      return r.map((x) => ({ id: x.id, name: x.name ?? null, on: !!x.whatsapp_alerts }));
    },
    async setAlertSwitch(fieldId, on) { check(await db.from("farm_fields").update({ whatsapp_alerts: on }).eq("id", fieldId), "alert switch"); },
    async alertFieldIds() {
      const r = check(await db.from("farm_fields").select("id").eq("whatsapp_alerts", true).is("deleted_at", null), "alert fields") as Array<{ id: string }>;
      return r.map((x) => x.id);
    },
    async sentAlerts(fieldId, since) {
      const r = check(await db.from("farm_alerts_sent").select("alert_key").eq("field_id", fieldId).gte("sent_at", since.toISOString()), "sent alerts") as Array<{ alert_key: string }>;
      return r.map((x) => x.alert_key);
    },
    async recordSentAlerts(fieldId, keys, to, at = new Date()) {
      if (!keys.length) return;
      check(await db.from("farm_alerts_sent").insert(keys.map((alert_key) => ({ field_id: fieldId, alert_key, sent_to: to, sent_at: at.toISOString() }))), "record alerts");
    },
  };
  return store;
}

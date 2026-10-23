import type { SupabaseClient } from "@supabase/supabase-js";
import type { MonthDay } from "./dates.js";

// Reading and saving groups, admins, members, photos and logos. Kept behind an
// interface so tests can use an in-memory version instead of a real database.

export interface Group {
  id: string;
  name: string;
  logoPath: string | null;
  /** The chosen design's id (see themes.ts). */
  theme: string;
  /** A colour replacing the design's accent, or null. */
  accent: string | null;
  backgroundPath: string | null;
  /** The plan's id (see plans.ts). */
  plan: string;
  /** When a paid plan runs out; null for never. */
  planUntil: Date | null;
  /** Finished flyers left in the group's free trial; null when it isn't on one. */
  trialFlyersLeft: number | null;
}

export interface Member {
  id: string;
  groupId: string;
  name: string;
  birthday: MonthDay;
  /** Null until a photo is added (e.g. members imported from a spreadsheet). */
  photoPath: string | null;
}

export interface Picture {
  data: Uint8Array;
  mimeType: string;
}

/** Where someone is in a guided conversation: setting up a group, or writing to support. */
export interface ChatState {
  step: "name" | "logo" | "design" | "support";
  groupId: string | null;
}

export interface FlyerStore {
  /** Groups this WhatsApp number is an admin of, most recently used first. */
  groupsForAdmin(waId: string): Promise<Group[]>;
  createGroup(name: string, adminWaId: string): Promise<Group>;
  addAdmin(groupId: string, waId: string): Promise<void>;
  /** Marks a group as the one this admin is working on. */
  useGroup(groupId: string, waId: string): Promise<void>;
  /** Saves the group's logo (replacing any earlier one). */
  saveLogo(groupId: string, logo: Picture): Promise<void>;
  /** Saves a background picture, or removes it when null. */
  saveBackground(groupId: string, picture: Picture | null): Promise<void>;
  /** Changes the group's design and/or accent colour (null clears the colour). */
  setStyle(groupId: string, style: { theme?: string; accent?: string | null }): Promise<void>;
  /**
   * Adds a member, or updates their birthday (and photo, if one is given) if
   * the name is already in the group. Returns whether they were new.
   * `original` is the photo as it was sent, kept when `photo` is a touched-up copy.
   */
  saveMember(
    groupId: string,
    name: string,
    birthday: MonthDay,
    photo: Picture | null,
    original?: Picture,
  ): Promise<Member & { isNew: boolean }>;
  removeMember(memberId: string): Promise<void>;
  members(groupId: string): Promise<Member[]>;
  /** Members with one of these birthdays, in active groups, with each group and its admins. */
  birthdaysOn(dates: MonthDay[]): Promise<Array<{ member: Member; group: Group; admins: string[] }>>;
  /** Downloads a saved photo or logo. */
  loadPicture(path: string): Promise<Uint8Array>;
  /** A member photo as it was sent, before any touching up; undefined if none was kept. */
  loadOriginal(photoPath: string): Promise<Uint8Array | undefined>;
  /**
   * The saved cut-out of a member photo (see cutout.ts): the PNG, null if the
   * photo has no person in it, or undefined if it hasn't been made yet.
   */
  loadCutout(photoPath: string): Promise<Uint8Array | null | undefined>;
  /** Saves a member photo's cut-out; null records that it has no person in it. */
  saveCutout(photoPath: string, png: Uint8Array | null): Promise<void>;
  /**
   * Records that this year's birthday flyer is going out. Returns false if it
   * was already recorded, in which case it must not be sent again.
   */
  claimBirthday(memberId: string, year: number): Promise<boolean>;
  /** Undoes a claim when the flyer couldn't be sent, so the next run tries again. */
  releaseBirthday(memberId: string, year: number): Promise<void>;
  /** Active groups whose name contains this text, for owners managing customers' groups. */
  findGroups(nameQuery: string): Promise<Group[]>;
  /** One group by its id, e.g. the one a payment was for; null if it's gone. */
  groupById(groupId: string): Promise<Group | null>;
  /** Puts a group on a plan until a date (null: no end date), ending any free trial. */
  setPlan(groupId: string, plan: string, until: Date | null): Promise<void>;
  /** Starts a free trial: the plan until a date, or until this many flyers are made. */
  startTrial(groupId: string, plan: string, until: Date, flyers: number): Promise<void>;
  /** Saves how many free trial flyers a group has left. */
  setTrialFlyersLeft(groupId: string, left: number): Promise<void>;
  adminCount(groupId: string): Promise<number>;
  /** Each plan's monthly price in kobo (null: price on request), from the database. */
  planPrices(): Promise<Map<string, number | null>>;
  /** Price per month, in kobo, when a plan is paid a year at a time; null when there's no yearly price. */
  planYearlyPrices(): Promise<Map<string, number | null>>;
  /** "From" prices in kobo for plans priced per customer (Organisation), shown instead of "price on request". */
  planStartingPrices?(): Promise<Map<string, number | null>>;
  /** Where this number is in a guided conversation, or null. Stale ones (over a day old) count as null. */
  chatState(waId: string): Promise<ChatState | null>;
  /** Saves where this number is in a guided conversation; null clears it. */
  setChatState(waId: string, state: ChatState | null): Promise<void>;
}

const UNIQUE_VIOLATION = "23505";
const BUCKET = "flyer-photos";

/** A photo's cut-out is saved next to it. A one-byte file means "no person found". */
export function cutoutPath(photoPath: string): string {
  return `${photoPath}.cutout.png`;
}

/** The photo as it was sent is saved next to the touched-up one. */
export function originalPath(photoPath: string): string {
  return `${photoPath}.original`;
}

/** Everything saved for one member photo. */
function photoFiles(photoPath: string): string[] {
  return [photoPath, cutoutPath(photoPath), originalPath(photoPath)];
}

function extFor(mimeType: string): string {
  return mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
}

interface MemberRow {
  id: string;
  group_id: string;
  name: string;
  birth_month: number;
  birth_day: number;
  photo_path: string | null;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    birthday: { month: row.birth_month, day: row.birth_day },
    photoPath: row.photo_path,
  };
}

const GROUP_COLUMNS = "id, name, logo_path, theme, accent, background_path, plan, plan_until, trial_flyers_left";

interface GroupRow {
  id: string;
  name: string;
  logo_path: string | null;
  theme: string;
  accent: string | null;
  background_path: string | null;
  plan: string;
  plan_until: string | null;
  trial_flyers_left: number | null;
}

function toGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    logoPath: row.logo_path,
    theme: row.theme,
    accent: row.accent,
    backgroundPath: row.background_path,
    plan: row.plan,
    planUntil: row.plan_until ? new Date(row.plan_until) : null,
    trialFlyersLeft: row.trial_flyers_left,
  };
}

const MEMBER_COLUMNS = "id, group_id, name, birth_month, birth_day, photo_path";

export function createSupabaseFlyerStore(db: SupabaseClient): FlyerStore {
  async function upload(path: string, picture: Picture) {
    const { error } = await db.storage
      .from(BUCKET)
      .upload(path, picture.data, { contentType: picture.mimeType, upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
  }

  return {
    async groupsForAdmin(waId) {
      const { data, error } = await db
        .from("flyer_admins")
        .select(`last_used_at, flyer_groups!inner(${GROUP_COLUMNS}, active)`)
        .eq("wa_id", waId)
        .eq("flyer_groups.active", true)
        .order("last_used_at", { ascending: false });
      if (error) throw new Error(`groupsForAdmin failed: ${error.message}`);
      return (data ?? []).map((row) => toGroup(row.flyer_groups as unknown as GroupRow));
    },

    async createGroup(name, adminWaId) {
      const { data, error } = await db.from("flyer_groups").insert({ name }).select(GROUP_COLUMNS).single();
      if (error) throw new Error(`createGroup failed: ${error.message}`);
      const group = toGroup(data as GroupRow);
      await this.addAdmin(group.id, adminWaId);
      return group;
    },

    async addAdmin(groupId, waId) {
      const { error } = await db
        .from("flyer_admins")
        .upsert({ group_id: groupId, wa_id: waId, last_used_at: new Date().toISOString() });
      if (error) throw new Error(`addAdmin failed: ${error.message}`);
    },

    async useGroup(groupId, waId) {
      const { error } = await db
        .from("flyer_admins")
        .update({ last_used_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("wa_id", waId);
      if (error) throw new Error(`useGroup failed: ${error.message}`);
    },

    async saveLogo(groupId, logo) {
      // A new file name each time, so WhatsApp and browsers never show an old cached logo.
      const path = `${groupId}/logo-${Date.now()}.${extFor(logo.mimeType)}`;
      await upload(path, logo);
      const { error } = await db.from("flyer_groups").update({ logo_path: path }).eq("id", groupId);
      if (error) throw new Error(`saveLogo failed: ${error.message}`);
    },

    async saveBackground(groupId, picture) {
      let path: string | null = null;
      if (picture) {
        path = `${groupId}/background-${Date.now()}.${extFor(picture.mimeType)}`;
        await upload(path, picture);
      }
      const { error } = await db.from("flyer_groups").update({ background_path: path }).eq("id", groupId);
      if (error) throw new Error(`saveBackground failed: ${error.message}`);
    },

    async setStyle(groupId, style) {
      const { error } = await db.from("flyer_groups").update(style).eq("id", groupId);
      if (error) throw new Error(`setStyle failed: ${error.message}`);
    },

    async saveMember(groupId, name, birthday, photo, original) {
      let path: string | null = null;
      if (photo) {
        path = `${groupId}/members/${crypto.randomUUID()}.${extFor(photo.mimeType)}`;
        await upload(path, photo);
        if (original) await upload(originalPath(path), original);
      }
      const row: Record<string, unknown> = { group_id: groupId, name, birth_month: birthday.month, birth_day: birthday.day };
      if (path) row.photo_path = path;

      const existing = (await this.members(groupId)).find((m) => m.name.toLowerCase() === name.toLowerCase());
      const query = existing
        ? db.from("flyer_members").update(row).eq("id", existing.id)
        : db.from("flyer_members").insert(row);
      const { data, error } = await query.select(MEMBER_COLUMNS).single();
      if (error) throw new Error(`saveMember failed: ${error.message}`);
      // A new photo replaces the old one, which is then deleted.
      if (existing?.photoPath && path) await db.storage.from(BUCKET).remove(photoFiles(existing.photoPath));
      return { ...toMember(data as MemberRow), isNew: !existing };
    },

    async removeMember(memberId) {
      const { data, error } = await db.from("flyer_members").delete().eq("id", memberId).select("photo_path");
      if (error) throw new Error(`removeMember failed: ${error.message}`);
      const paths = (data ?? []).map((r) => r.photo_path as string | null).filter((p): p is string => !!p);
      if (paths.length) await db.storage.from(BUCKET).remove(paths.flatMap(photoFiles));
    },

    async members(groupId) {
      const { data, error } = await db.from("flyer_members").select(MEMBER_COLUMNS).eq("group_id", groupId).order("name");
      if (error) throw new Error(`members failed: ${error.message}`);
      return (data ?? []).map((r) => toMember(r as MemberRow));
    },

    async birthdaysOn(dates) {
      const out: Array<{ member: Member; group: Group; admins: string[] }> = [];
      for (const { month, day } of dates) {
        const { data, error } = await db
          .from("flyer_members")
          .select(`${MEMBER_COLUMNS}, flyer_groups!inner(${GROUP_COLUMNS}, active, flyer_admins(wa_id))`)
          .eq("birth_month", month)
          .eq("birth_day", day)
          .eq("flyer_groups.active", true);
        if (error) throw new Error(`birthdaysOn failed: ${error.message}`);
        for (const row of data ?? []) {
          const g = row.flyer_groups as unknown as GroupRow & { flyer_admins: Array<{ wa_id: string }> };
          out.push({
            member: toMember(row as unknown as MemberRow),
            group: toGroup(g),
            admins: g.flyer_admins.map((a) => a.wa_id),
          });
        }
      }
      return out;
    },

    async loadPicture(path) {
      const { data, error } = await db.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(`loadPicture failed: ${error?.message ?? "no data"}`);
      return new Uint8Array(await data.arrayBuffer());
    },

    async loadOriginal(photoPath) {
      const { data, error } = await db.storage.from(BUCKET).download(originalPath(photoPath));
      if (error || !data) return undefined;
      return new Uint8Array(await data.arrayBuffer());
    },

    async loadCutout(photoPath) {
      const { data, error } = await db.storage.from(BUCKET).download(cutoutPath(photoPath));
      if (error || !data) return undefined; // not made yet
      const bytes = new Uint8Array(await data.arrayBuffer());
      return bytes.length > 1 ? bytes : null;
    },

    async saveCutout(photoPath, png) {
      await upload(cutoutPath(photoPath), { data: png ?? new Uint8Array([0]), mimeType: "image/png" });
    },

    async claimBirthday(memberId, year) {
      const { error } = await db.from("flyer_birthday_sends").insert({ member_id: memberId, year });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      throw new Error(`claimBirthday failed: ${error.message}`);
    },

    async releaseBirthday(memberId, year) {
      const { error } = await db.from("flyer_birthday_sends").delete().eq("member_id", memberId).eq("year", year);
      if (error) throw new Error(`releaseBirthday failed: ${error.message}`);
    },

    async findGroups(nameQuery) {
      // Escape the characters that have a meaning in a LIKE pattern.
      const pattern = `%${nameQuery.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const { data, error } = await db
        .from("flyer_groups")
        .select(GROUP_COLUMNS)
        .eq("active", true)
        .ilike("name", pattern)
        .order("name")
        .limit(20);
      if (error) throw new Error(`findGroups failed: ${error.message}`);
      return (data ?? []).map((r) => toGroup(r as GroupRow));
    },

    async groupById(groupId) {
      const { data, error } = await db.from("flyer_groups").select(GROUP_COLUMNS).eq("id", groupId).maybeSingle();
      if (error) throw new Error(`groupById failed: ${error.message}`);
      return data ? toGroup(data as GroupRow) : null;
    },

    async setPlan(groupId, plan, until) {
      const { error } = await db
        .from("flyer_groups")
        .update({ plan, plan_until: until ? until.toISOString() : null, trial_flyers_left: null })
        .eq("id", groupId);
      if (error) throw new Error(`setPlan failed: ${error.message}`);
    },

    async startTrial(groupId, plan, until, flyers) {
      const { error } = await db
        .from("flyer_groups")
        .update({ plan, plan_until: until.toISOString(), trial_flyers_left: flyers })
        .eq("id", groupId);
      if (error) throw new Error(`startTrial failed: ${error.message}`);
    },

    async setTrialFlyersLeft(groupId, left) {
      const { error } = await db.from("flyer_groups").update({ trial_flyers_left: left }).eq("id", groupId);
      if (error) throw new Error(`setTrialFlyersLeft failed: ${error.message}`);
    },

    async adminCount(groupId) {
      const { count, error } = await db
        .from("flyer_admins")
        .select("wa_id", { count: "exact", head: true })
        .eq("group_id", groupId);
      if (error) throw new Error(`adminCount failed: ${error.message}`);
      return count ?? 0;
    },

    async planPrices() {
      const { data, error } = await db.from("flyer_plans").select("id, monthly_price_kobo");
      if (error) throw new Error(`planPrices failed: ${error.message}`);
      return new Map((data ?? []).map((r) => [r.id as string, r.monthly_price_kobo === null ? null : Number(r.monthly_price_kobo)]));
    },

    async planYearlyPrices() {
      const { data, error } = await db.from("flyer_plans").select("id, monthly_price_paid_yearly_kobo");
      if (error) throw new Error(`planYearlyPrices failed: ${error.message}`);
      return new Map(
        (data ?? []).map((r) => [r.id as string, r.monthly_price_paid_yearly_kobo === null ? null : Number(r.monthly_price_paid_yearly_kobo)]),
      );
    },

    async planStartingPrices() {
      const { data, error } = await db.from("flyer_plans").select("id, starting_price_kobo");
      if (error) throw new Error(`planStartingPrices failed: ${error.message}`);
      return new Map((data ?? []).map((r) => [r.id as string, r.starting_price_kobo === null ? null : Number(r.starting_price_kobo)]));
    },

    async chatState(waId) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await db
        .from("flyer_chat_state")
        .select("step, group_id")
        .eq("wa_id", waId)
        .gte("updated_at", since)
        .maybeSingle();
      if (error) throw new Error(`chatState failed: ${error.message}`);
      return data ? { step: data.step as ChatState["step"], groupId: data.group_id as string | null } : null;
    },

    async setChatState(waId, state) {
      const { error } = state
        ? await db
            .from("flyer_chat_state")
            .upsert({ wa_id: waId, step: state.step, group_id: state.groupId, updated_at: new Date().toISOString() })
        : await db.from("flyer_chat_state").delete().eq("wa_id", waId);
      if (error) throw new Error(`setChatState failed: ${error.message}`);
    },
  };
}

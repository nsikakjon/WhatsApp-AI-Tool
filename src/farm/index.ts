import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { clientIp, createLoginThrottle, guardedBasicAuth } from "../core/security/guard.js";
import { cleanField, mergeField } from "./merge.js";
import type { FarmStore, FarmUser, FieldRow } from "./store.js";
import { ringHectares, type Satellite } from "./satellite.js";
import { cleanAsk, cleanContext, type FarmAssistant } from "./assistant.js";

// Oko: the farm and land app at /farm/.
//
// The app itself is plain files in /farm-app. This module hands them out and
// runs the small API the app syncs with:
//   - Jay opens /farm/admin with FARM_PASSWORD and becomes the admin;
//   - he makes invite links for testers; a tester taps one, types a name and
//     is logged in on that phone (no password to remember);
//   - a field's owner can invite helpers (a farm manager, a worker) to it;
//   - each phone keeps working offline and syncs its fields when it can.
// It talks to nothing but its own tables (migration 0076), so it can't affect
// the WhatsApp bots.

export interface FarmDeps {
  /** Jay's password for /farm/admin. */
  password: string;
  /** Saved fields and logins. Without it the app still works, on each phone only. */
  store?: FarmStore;
  /** Where the app's files are. Defaults to /farm-app at the top of the project. */
  dir?: string;
  readFile?: (path: string) => Promise<Uint8Array>;
  log?: Pick<Console, "info" | "error">;
  now?: () => Date;
  /** Satellite crop health (COPERNICUS_CLIENT_ID / _SECRET). */
  satellite?: Satellite;
  /** The AI farm assistant (ANTHROPIC_API_KEY). Off when missing. */
  assistant?: FarmAssistant;
  /** Questions each person can ask the assistant a day (Lagos time). */
  assistantDailyLimit?: number;
}

export const FARM_DIR = fileURLToPath(new URL("../../farm-app/", import.meta.url));

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/manifest+json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
};

const COOKIE = "oko_session";
const SESSION_DAYS = 180;
const APP_INVITE_DAYS = 14;
const FIELD_INVITE_DAYS = 7;
const MAX_FIELD_BYTES = 1_500_000;
const MAX_PHOTO_BYTES = 3_000_000;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const FIELD_ID = /^[a-z0-9]{6,40}$/i;

/** The file a request asks for, or null if it isn't one the app has. */
export function farmFile(path: string): string | null {
  const rel = path === "" || path === "/" ? "index.html" : path.replace(/^\/+/, "");
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(rel) || rel.includes("..") || rel.includes("//")) return null;
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return ext in TYPES ? rel : null;
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

type Env = { Variables: { user: FarmUser } };
type Access = "owner" | "helper" | "admin" | null;

export function createFarm(deps: FarmDeps) {
  const app = new Hono<Env>();
  const dir = resolve(deps.dir ?? FARM_DIR);
  const read = deps.readFile ?? ((p: string) => fsReadFile(p));
  const log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());
  const store = deps.store;
  const badTokens = createLoginThrottle(20, 15 * 60 * 1000);
  const satBusy = new Map<string, Promise<unknown>>();
  const askLimit = deps.assistantDailyLimit ?? 30;
  let askDay = "";
  const asked = new Map<string, number>();

  app.onError((err, c) => {
    log.error("Farm app request failed:", err);
    return c.json({ error: "Something went wrong on the server. Try again in a minute." }, 500);
  });

  /* ---------- Jay's login ---------- */
  app.use("/admin", guardedBasicAuth({ password: deps.password, realm: "yarnOga farm" }));
  app.get("/admin", async (c) => {
    if (!store) return c.text("Saving to the database is off: run migration 0076 and redeploy.", 503);
    const admin = await store.admin();
    await startSession(c, admin);
    return c.redirect("/farm/", 302);
  });

  /* ---------- API ---------- */
  const api = new Hono<Env>();
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!store) return c.json({ error: "offline", message: "Saving to the database isn't switched on yet." }, 503);
    if (c.req.method !== "GET" && !sameSite(c)) return c.json({ error: "This request must come from the app itself." }, 403);
    await next();
  });

  // What an invite link is for, before the person accepts it.
  api.get("/invites/peek", async (c) => {
    const token = c.req.query("token") ?? "";
    const inv = await usableInvite(c, token);
    if (!inv) return c.json({ valid: false });
    const field = inv.fieldId ? await store!.field(inv.fieldId) : null;
    const from = await store!.user(inv.createdBy);
    return c.json({ valid: true, kind: inv.kind, nameHint: inv.nameHint, fieldName: fieldName(field), from: from?.name ?? null });
  });

  api.post("/invites/accept", async (c) => {
    const body = await jsonBody<{ token?: string; name?: string }>(c);
    const token = String(body?.token ?? "");
    const inv = await usableInvite(c, token);
    if (!inv) return c.json({ error: "This invite link has expired or was already used. Ask for a new one." }, 410);
    let user = await currentUser(c);
    if (!user) {
      const name = String(body?.name ?? inv.nameHint ?? "").trim().slice(0, 60);
      if (!name) return c.json({ error: "Type your name." }, 400);
      user = await store!.createUser(name, "tester");
    }
    if (!(await store!.useInvite(hashToken(token), user.id, now()))) return c.json({ error: "This invite link was just used. Ask for a new one." }, 410);
    if (inv.kind === "field" && inv.fieldId) {
      const field = await store!.field(inv.fieldId);
      if (field && !field.deletedAt && field.ownerId !== user.id) {
        await store!.addMember(inv.fieldId, user.id);
        await store!.touchField(inv.fieldId);
      }
    }
    if (!getCookie(c, COOKIE) || !(await currentUser(c))) await startSession(c, user);
    log.info(`Farm: ${user.name} joined with a ${inv.kind} invite`);
    return c.json({ user: publicUser(user), fieldId: inv.fieldId });
  });

  // Everything below needs a login.
  api.use("*", async (c, next) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "login", message: "You're not logged in on this phone." }, 401);
    c.set("user", user);
    if (!user.lastSeen || now().getTime() - user.lastSeen.getTime() > 3600_000) await store!.seen(user.id);
    await next();
  });

  api.get("/me", (c) => c.json({ user: publicUser(c.get("user")) }));

  api.post("/logout", async (c) => {
    const t = getCookie(c, COOKIE);
    if (t) await store!.deleteSession(hashToken(t));
    deleteCookie(c, COOKIE, { path: "/farm" });
    return c.json({ ok: true });
  });

  api.get("/sync", async (c) => {
    const user = c.get("user");
    const sinceQ = c.req.query("since");
    const since = sinceQ && !Number.isNaN(Date.parse(sinceQ)) ? new Date(sinceQ) : null;
    const serverTime = now();
    const rows = await store!.fieldsFor(user, since);
    const owners = new Map((await store!.users()).map((u) => [u.id, u.name]));
    const fields = await Promise.all(rows.map(async (r) => ({ ...fieldOut(r, owners), access: await access(user, r) })));
    return c.json({ now: serverTime.toISOString(), fields, access: await store!.accessible(user) });
  });

  api.put("/fields/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!FIELD_ID.test(id)) return c.json({ error: "Bad field id." }, 400);
    const raw = await c.req.text();
    if (raw.length > MAX_FIELD_BYTES) return c.json({ error: "This field is too big to save. Photos should upload separately; try syncing again." }, 413);
    let incoming: Record<string, unknown>;
    try {
      const j = JSON.parse(raw) as { data?: unknown };
      if (!j || typeof j.data !== "object" || j.data === null || Array.isArray(j.data)) throw new Error();
      incoming = { ...(j.data as Record<string, unknown>), id };
    } catch {
      return c.json({ error: "That isn't a field." }, 400);
    }
    if (hasInlinePhotos(incoming)) return c.json({ error: "Upload photos first." }, 400);
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await store!.field(id);
      if (cur) {
        const a = await access(user, cur);
        if (!a) return c.json({ error: "You don't have access to this field." }, 403);
        if (cur.deletedAt) return c.json({ error: "deleted", message: "This field was deleted." }, 410);
      }
      const merged = mergeField(cur ? cur.data : null, incoming);
      const saved = await store!.writeField(id, cur?.ownerId ?? user.id, merged, cur?.version ?? 0, user.id);
      if (saved) {
        const owners = new Map((await store!.users()).map((u) => [u.id, u.name]));
        return c.json({ field: { ...fieldOut(saved, owners), access: await access(user, saved) } });
      }
      // Someone else saved in between: combine with theirs and try again.
    }
    return c.json({ error: "busy", message: "Lots of changes at once; trying again shortly." }, 409);
  });

  api.delete("/fields/:id", async (c) => {
    const user = c.get("user");
    const field = await store!.field(c.req.param("id"));
    if (!field || field.deletedAt) return c.json({ ok: true });
    const a = await access(user, field);
    if (a === "owner" || a === "admin") await store!.deleteField(field.id, user.id);
    else if (a === "helper") await store!.removeMember(field.id, user.id); // a helper leaving
    else return c.json({ error: "You don't have access to this field." }, 403);
    return c.json({ ok: true, left: a === "helper" });
  });

  api.get("/fields/:id/members", async (c) => {
    const user = c.get("user");
    const field = await store!.field(c.req.param("id"));
    if (!field || !(await access(user, field))) return c.json({ error: "Not found." }, 404);
    const owner = await store!.user(field.ownerId);
    return c.json({ owner: owner ? { userId: owner.id, name: owner.name } : null, members: await store!.members(field.id) });
  });

  api.delete("/fields/:id/members/:userId", async (c) => {
    const user = c.get("user");
    const field = await store!.field(c.req.param("id"));
    const a = field ? await access(user, field) : null;
    if (!field || (a !== "owner" && a !== "admin")) return c.json({ error: "Only the field's owner can remove helpers." }, 403);
    await store!.removeMember(field.id, c.req.param("userId"));
    await store!.touchField(field.id);
    return c.json({ ok: true });
  });

  api.post("/invites", async (c) => {
    const user = c.get("user");
    const body = await jsonBody<{ kind?: string; fieldId?: string; nameHint?: string }>(c);
    const kind = body?.kind === "field" ? "field" : "app";
    if (kind === "app" && user.role !== "admin") return c.json({ error: "Only Jay can invite new testers." }, 403);
    let fieldId: string | null = null;
    if (kind === "field") {
      const field = await store!.field(String(body?.fieldId ?? ""));
      const a = field ? await access(user, field) : null;
      if (!field || field.deletedAt || (a !== "owner" && a !== "admin")) return c.json({ error: "Sync the field first, then invite helpers." }, 403);
      fieldId = field.id;
    }
    const token = newToken();
    const days = kind === "app" ? APP_INVITE_DAYS : FIELD_INVITE_DAYS;
    const nameHint = body?.nameHint ? String(body.nameHint).trim().slice(0, 60) || null : null;
    await store!.createInvite(hashToken(token), { kind, fieldId, nameHint, createdBy: user.id, expiresAt: new Date(now().getTime() + days * 86400_000) });
    return c.json({ url: `${origin(c)}/farm/#invite=${token}`, expiresInDays: days });
  });

  api.post("/photos", async (c) => {
    const user = c.get("user");
    const fieldId = c.req.query("field") ?? "";
    const field = FIELD_ID.test(fieldId) ? await store!.field(fieldId) : null;
    if (field && !(await access(user, field))) return c.json({ error: "You don't have access to this field." }, 403);
    const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
    if (!PHOTO_TYPES.has(type)) return c.json({ error: "Photos must be JPEG, PNG or WebP." }, 415);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (!data.byteLength || data.byteLength > MAX_PHOTO_BYTES) return c.json({ error: "That photo is too big." }, 413);
    if (!FIELD_ID.test(fieldId)) return c.json({ error: "Bad field id." }, 400);
    const id = await store!.savePhoto(fieldId, data, type, user.id);
    return c.json({ id });
  });

  api.get("/photos/:id", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/.test(id)) return c.json({ error: "Not found." }, 404);
    const p = await store!.photo(id);
    if (!p) return c.json({ error: "Not found." }, 404);
    const field = await store!.field(p.fieldId);
    // A photo for a field that hasn't synced yet: only its uploader's team can see it once it does.
    if (field ? !(await access(user, field)) : user.role !== "admin") return c.json({ error: "Not found." }, 404);
    return new Response(new Uint8Array(p.data), { headers: { "Content-Type": p.mimeType, "Cache-Control": "private, max-age=31536000, immutable" } });
  });

  /* ---------- satellite crop health ---------- */
  api.get("/fields/:id/satellite", async (c) => {
    const user = c.get("user");
    const field = await store!.field(c.req.param("id"));
    if (!field || field.deletedAt || !(await access(user, field))) return c.json({ error: "Not found." }, 404);
    if (!deps.satellite) return c.json({ configured: false });
    const ring = boundaryRing(field.data);
    if (!ring) return c.json({ configured: true, needsBoundary: true });
    if (ringHectares(ring) > SAT_MAX_HA) return c.json({ configured: true, error: `Fields over ${SAT_MAX_HA} ha aren't supported yet.` });
    const key = ring.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";");
    const cached = await store!.satellite(field.id);
    const fresh = cached && cached.boundaryKey === key && now().getTime() - cached.fetchedAt.getTime() < SAT_REFRESH_MS;
    if (fresh) return c.json(satOut(field.id, cached));
    let job = satBusy.get(field.id);
    if (!job) {
      job = (async () => {
        const to = now();
        const series = await deps.satellite!.ndviSeries(ring, new Date(to.getTime() - 365 * 86400_000), to);
        const latest = series[series.length - 1];
        const sameImage = cached && cached.boundaryKey === key && latest && cached.imageDate === latest.date;
        const image = latest && !sameImage ? await deps.satellite!.ndviImage(ring, latest.date) : null;
        const row = { boundaryKey: key, series, fetchedAt: to, imageDate: latest ? latest.date : null };
        await store!.saveSatellite(field.id, row, image);
        return row;
      })().finally(() => satBusy.delete(field.id));
      satBusy.set(field.id, job);
    }
    try {
      const row = (await job) as Awaited<ReturnType<FarmStore["satellite"]>>;
      return c.json(satOut(field.id, row!));
    } catch (err) {
      log.error("Farm satellite request failed:", err);
      if (cached && cached.boundaryKey === key) return c.json({ ...satOut(field.id, cached), stale: true });
      return c.json({ configured: true, error: "The satellite service didn't answer. Try again later." }, 502);
    }
  });

  api.get("/fields/:id/satellite.png", async (c) => {
    const user = c.get("user");
    const field = await store!.field(c.req.param("id"));
    if (!field || !(await access(user, field))) return c.json({ error: "Not found." }, 404);
    const img = await store!.satelliteImage(field.id);
    if (!img) return c.json({ error: "Not found." }, 404);
    return new Response(new Uint8Array(img), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" } });
  });

  /* ---------- AI farm assistant ---------- */
  // The phone sends the question and a summary of the field (it has the weather
  // and satellite caches, and fields that haven't synced yet). If the field is
  // on the server, only its owner, helpers and Jay may ask about it.
  api.post("/fields/:id/ask", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    if (!FIELD_ID.test(id)) return c.json({ error: "Bad field id." }, 400);
    if (!deps.assistant) return c.json({ configured: false, error: "The farm assistant isn't switched on yet." }, 503);
    const field = await store!.field(id);
    if (field && !(await access(user, field))) return c.json({ error: "You don't have access to this field." }, 403);
    if (field?.deletedAt) return c.json({ error: "This field was deleted." }, 410);
    const raw = await c.req.text();
    if (raw.length > 40_000) return c.json({ error: "That question is too long." }, 413);
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      /* handled below */
    }
    const ask = cleanAsk(body);
    if (!ask) return c.json({ error: "Type a question (up to 600 letters)." }, 400);
    const today = new Date(now().getTime() + 3600_000).toISOString().slice(0, 10); // Lagos is UTC+1
    if (today !== askDay) {
      askDay = today;
      asked.clear();
    }
    const used = asked.get(user.id) ?? 0;
    if (used >= askLimit) return c.json({ error: `That's today's ${askLimit} questions. The assistant is back tomorrow.` }, 429);
    asked.set(user.id, used + 1);
    try {
      const answer = await deps.assistant.ask({ ...ask, context: cleanContext((body as { context?: unknown }).context) });
      return c.json({ answer, left: askLimit - used - 1 });
    } catch (err) {
      log.error("Farm assistant failed:", err);
      asked.set(user.id, Math.max(0, (asked.get(user.id) ?? 1) - 1)); // a failed answer doesn't use up a question
      return c.json({ error: "The assistant didn't answer. Try again in a minute." }, 502);
    }
  });

  /* ---------- admin ---------- */
  api.use("/admin/*", async (c, next) => {
    if (c.get("user").role !== "admin") return c.json({ error: "Only Jay can see this." }, 403);
    await next();
  });
  api.get("/admin/users", async (c) => {
    const counts = await store!.fieldCounts();
    const users = (await store!.users()).map((u) => ({ ...publicUser(u), disabled: u.disabled, fields: counts.get(u.id) ?? 0, joined: u.createdAt.toISOString(), lastSeen: u.lastSeen?.toISOString() ?? null }));
    return c.json({ users });
  });
  api.post("/admin/users/:id/disable", async (c) => {
    const target = await store!.user(c.req.param("id"));
    if (!target || target.role === "admin") return c.json({ error: "Not found." }, 404);
    const body = await jsonBody<{ disabled?: boolean }>(c);
    await store!.setDisabled(target.id, body?.disabled !== false);
    return c.json({ ok: true });
  });

  api.all("*", (c) => c.json({ error: "Not found." }, 404));
  app.route("/api", api);

  /* ---------- the app's files ---------- */
  const serve = async (rel: string | null) => {
    if (!rel) return new Response("Not found", { status: 404 });
    const full = resolve(join(dir, rel));
    if (!full.startsWith(dir + sep)) return new Response("Not found", { status: 404 });
    try {
      const body = await read(full);
      const ext = rel.split(".").pop()!.toLowerCase();
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type": TYPES[ext]!,
          // Check for a newer version each time; the phone keeps its own copy for offline use.
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
          // GPS, camera (for photos) and nothing else.
          "Permissions-Policy": "geolocation=(self), camera=(self), microphone=()",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };
  app.get("/", () => serve("index.html"));
  app.get("/*", (c) => serve(farmFile(relPath(c.req.path))));
  return app;

  /* ---------- helpers ---------- */
  async function currentUser(c: Context): Promise<FarmUser | null> {
    const t = getCookie(c, COOKIE);
    if (!t || !store) return null;
    return store.sessionUser(hashToken(t), now());
  }
  async function startSession(c: Context, user: FarmUser) {
    const token = newToken();
    await store!.createSession(hashToken(token), user.id, new Date(now().getTime() + SESSION_DAYS * 86400_000));
    setCookie(c, COOKIE, token, { path: "/farm", httpOnly: true, sameSite: "Lax", secure: isHttps(c), maxAge: SESSION_DAYS * 86400 });
  }
  async function usableInvite(c: Context, token: string) {
    const ip = clientIp(c);
    if (badTokens.blocked(ip)) return null;
    if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) {
      badTokens.failed(ip);
      return null;
    }
    const inv = await store!.invite(hashToken(token), now());
    if (!inv) badTokens.failed(ip);
    return inv;
  }
  async function access(user: FarmUser, field: FieldRow): Promise<Access> {
    if (field.ownerId === user.id) return "owner";
    if (user.role === "admin") return "admin";
    return (await store!.isMember(field.id, user.id)) ? "helper" : null;
  }
}

const SAT_MAX_HA = 2000;
const SAT_REFRESH_MS = 12 * 3600_000;

/** The field's boundary as [lon, lat] points, when it has one. */
export function boundaryRing(data: Record<string, unknown>): Array<[number, number]> | null {
  const b = Array.isArray(data.beacons) ? (data.beacons as Array<{ lat?: unknown; lon?: unknown }>) : [];
  const ring = b
    .map((p) => [Number(p.lon), Number(p.lat)] as [number, number])
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180);
  return ring.length >= 3 ? ring : null;
}
function satOut(fieldId: string, row: NonNullable<Awaited<ReturnType<FarmStore["satellite"]>>>) {
  return {
    configured: true,
    series: row.series,
    latest: row.series[row.series.length - 1] ?? null,
    imageUrl: row.imageDate ? `api/fields/${fieldId}/satellite.png?d=${row.imageDate}` : null,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

function fieldOut(r: FieldRow, owners: Map<string, string>) {
  return { id: r.id, data: cleanField(r.data), version: r.version, updatedAt: r.updatedAt.toISOString(), ownerId: r.ownerId, ownerName: owners.get(r.ownerId) ?? null, deleted: !!r.deletedAt };
}
function fieldName(f: FieldRow | null): string | null {
  const name = (f?.data?.f as { name?: unknown } | undefined)?.name;
  return typeof name === "string" ? name : null;
}
const publicUser = (u: FarmUser) => ({ id: u.id, name: u.name, role: u.role });

function hasInlinePhotos(v: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (typeof v === "string") return v.startsWith("data:image/");
  if (Array.isArray(v)) return v.some((x) => hasInlinePhotos(x, depth + 1));
  if (v && typeof v === "object") return Object.values(v).some((x) => hasInlinePhotos(x, depth + 1));
  return false;
}
async function jsonBody<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}
function isHttps(c: Context): boolean {
  return (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "")) === "https";
}
function origin(c: Context): string {
  const u = new URL(c.req.url);
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? u.host;
  return `${isHttps(c) ? "https" : "http"}://${host}`;
}
/** Requests that change things must come from a page on this site, and say they're from the app. */
function sameSite(c: Context): boolean {
  if (c.req.header("x-oko") !== "1") return false;
  const o = c.req.header("origin");
  if (!o) return true;
  try {
    return new URL(o).host === (c.req.header("x-forwarded-host") ?? c.req.header("host"));
  } catch {
    return false;
  }
}
/** The part of the address after /farm/. */
function relPath(path: string): string {
  return path.replace(/^\/farm(\/|$)/, "/").replace(/^\/+/, "");
}

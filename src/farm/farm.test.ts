import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createFarm, farmFile, FARM_DIR } from "./index.js";
import { memoryFarmStore } from "./store.js";
import { mergeField } from "./merge.js";

const PASSWORD = "farm-password-123";
const quiet = { info() {}, error() {} };

/** A tiny browser: keeps the login cookie and sends the app's header. */
function phone(app: ReturnType<typeof createFarm>) {
  let cookie = "";
  const req = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    if (init.method && init.method !== "GET") headers.set("x-oko", "1");
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      init = { ...init, body: JSON.stringify(init.json) };
    }
    const res = await app.request(path, { ...init, headers });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return res;
  };
  return { req, json: async (path: string, init: RequestInit & { json?: unknown } = {}) => (await req(path, init)).json() as Promise<any> };
}
const asAdmin = async (app: ReturnType<typeof createFarm>) => {
  const p = phone(app);
  const r = await p.req("/admin", { headers: { authorization: `Basic ${btoa(`jay:${PASSWORD}`)}` } });
  expect(r.status).toBe(302);
  return p;
};
async function invite(admin: ReturnType<typeof phone>, body: Record<string, unknown>) {
  const { url } = await admin.json("/api/invites", { method: "POST", json: body });
  return String(url).split("#invite=")[1]!;
}

describe("farm app files", () => {
  it("serves the app to anyone (it holds no data) with the right types", async () => {
    const app = createFarm({ password: PASSWORD });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("js/app.js");
    expect((await app.request("/js/crops.js")).headers.get("content-type")).toContain("javascript");
    expect((await app.request("/manifest.json")).status).toBe(200);
  });

  it("only hands out the app's own files", async () => {
    expect(farmFile("../.env")).toBeNull();
    expect(farmFile("js/../../package.json")).toBeNull();
    expect(farmFile(".env")).toBeNull();
    expect(farmFile("notes.txt")).toBeNull();
    expect(farmFile("")).toBe("index.html");
    const app = createFarm({ password: PASSWORD });
    expect((await app.request("/..%2F.env")).status).toBe(404);
    expect((await app.request("/missing.js")).status).toBe(404);
  });

  it("every file the page and offline helper load is there", () => {
    const html = readFileSync(`${FARM_DIR}index.html`, "utf8");
    const sw = readFileSync(`${FARM_DIR}sw.js`, "utf8");
    const local = [...html.matchAll(/(?:src|href)="([^":]+)"/g)].map((m) => m[1]!);
    const cached = JSON.parse(sw.match(/const FILES=(\[[^\]]+\])/)![1]!) as string[];
    for (const f of [...local, ...cached].filter((f) => f !== "./")) {
      expect(farmFile(f), f).not.toBeNull();
      expect(() => readFileSync(`${FARM_DIR}${f}`), f).not.toThrow();
    }
  });
});

describe("farm logins and invites", () => {
  it("admin login needs FARM_PASSWORD", async () => {
    const app = createFarm({ password: PASSWORD, store: memoryFarmStore(), log: quiet });
    expect((await app.request("/admin")).status).toBe(401);
    expect((await app.request("/admin", { headers: { authorization: `Basic ${btoa("x:wrong-password!!")}` } })).status).toBe(401);
    const admin = await asAdmin(app);
    expect((await admin.json("/api/me")).user.role).toBe("admin");
  });

  it("the API needs a login", async () => {
    const app = createFarm({ password: PASSWORD, store: memoryFarmStore(), log: quiet });
    expect((await app.request("/api/sync")).status).toBe(401);
  });

  it("a tester joins with an invite link once, and only Jay can invite testers", async () => {
    const app = createFarm({ password: PASSWORD, store: memoryFarmStore(), log: quiet });
    const admin = await asAdmin(app);
    const token = await invite(admin, { kind: "app", nameHint: "Tunde" });
    const tunde = phone(app);
    expect(await tunde.json(`/api/invites/peek?token=${token}`)).toMatchObject({ valid: true, kind: "app", nameHint: "Tunde", from: "Jay" });
    const joined = await tunde.json("/api/invites/accept", { method: "POST", json: { token, name: "Tunde Bakare" } });
    expect(joined.user).toMatchObject({ name: "Tunde Bakare", role: "tester" });
    expect((await tunde.json("/api/me")).user.name).toBe("Tunde Bakare");
    // used up
    expect((await phone(app).req("/api/invites/accept", { method: "POST", json: { token, name: "Someone" } })).status).toBe(410);
    // testers can't make tester invites
    expect((await tunde.req("/api/invites", { method: "POST", json: { kind: "app" } })).status).toBe(403);
  });

  it("refuses changes that don't come from the app", async () => {
    const app = createFarm({ password: PASSWORD, store: memoryFarmStore(), log: quiet });
    const admin = await asAdmin(app);
    const res = await admin.req("/api/fields/abc12345", { method: "PUT", json: { data: {} }, headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  it("expired invites don't work", async () => {
    let t = new Date("2026-11-01T10:00:00Z");
    const app = createFarm({ password: PASSWORD, store: memoryFarmStore(), log: quiet, now: () => t });
    const token = await invite(await asAdmin(app), { kind: "app" });
    t = new Date("2026-11-20T10:00:00Z");
    expect(await phone(app).json(`/api/invites/peek?token=${token}`)).toEqual({ valid: false });
  });
});

describe("farm sync and sharing", () => {
  async function setup() {
    const store = memoryFarmStore();
    const app = createFarm({ password: PASSWORD, store, log: quiet });
    const admin = await asAdmin(app);
    const owner = phone(app);
    await owner.req("/api/invites/accept", { method: "POST", json: { token: await invite(admin, { kind: "app" }), name: "Ada" } });
    return { store, app, admin, owner };
  }
  const field = (extra: Record<string, unknown> = {}) => ({ f: { name: "Idanre cocoa" }, kind: "crop", crop: { id: "cocoa" }, scouts: [], records: [], beacons: [], features: [], tasks: [], taskState: {}, ...extra });

  it("saves a field and gives it back on another phone, without the phone-only bits", async () => {
    const { owner, app } = await setup();
    const put = await owner.json("/api/fields/fld000001", { method: "PUT", json: { data: field({ wx: { big: true }, demo: false }) } });
    expect(put.field).toMatchObject({ id: "fld000001", version: 1, access: "owner", ownerName: "Ada" });
    const sync = await owner.json("/api/sync");
    expect(sync.access).toEqual(["fld000001"]);
    expect(sync.fields[0].data.wx).toBeUndefined();
    // a stranger sees nothing
    expect((await phone(app).req("/api/sync")).status).toBe(401);
  });

  it("refuses photos stuffed inside the field (they upload separately)", async () => {
    const { owner } = await setup();
    const res = await owner.req("/api/fields/fld000002", { method: "PUT", json: { data: field({ scouts: [{ id: "s1", photo: "data:image/jpeg;base64,AAAA" }] }) } });
    expect(res.status).toBe(400);
  });

  it("a helper joins a field, both phones' scouting is kept, and the owner can remove them", async () => {
    const { owner, admin, app } = await setup();
    await owner.req("/api/fields/fld000003", { method: "PUT", json: { data: field() } });
    const { url } = await owner.json("/api/invites", { method: "POST", json: { kind: "field", fieldId: "fld000003" } });
    const helper = phone(app);
    const token = url.split("#invite=")[1];
    expect((await helper.json(`/api/invites/peek?token=${token}`)).fieldName).toBe("Idanre cocoa");
    await helper.req("/api/invites/accept", { method: "POST", json: { token, name: "Farm manager" } });
    expect((await helper.json("/api/sync")).access).toEqual(["fld000003"]);

    // both add a scouting walk offline, then sync
    await owner.req("/api/fields/fld000003", { method: "PUT", json: { data: field({ scouts: [{ id: "a", health: 4 }] }) } });
    const merged = await helper.json("/api/fields/fld000003", { method: "PUT", json: { data: field({ scouts: [{ id: "b", health: 3 }] }) } });
    expect(merged.field.data.scouts.map((s: { id: string }) => s.id).sort()).toEqual(["a", "b"]);
    expect(merged.field.access).toBe("helper");

    // Jay sees it too (admin view)
    expect((await admin.json("/api/sync")).access).toContain("fld000003");

    const { members } = await owner.json("/api/fields/fld000003/members");
    expect(members.map((m: { name: string }) => m.name)).toEqual(["Farm manager"]);
    // a helper can't remove people
    expect((await helper.req(`/api/fields/fld000003/members/${members[0].userId}`, { method: "DELETE" })).status).toBe(403);
    await owner.req(`/api/fields/fld000003/members/${members[0].userId}`, { method: "DELETE" });
    expect((await helper.json("/api/sync")).access).toEqual([]);
    expect((await helper.req("/api/fields/fld000003", { method: "PUT", json: { data: field() } })).status).toBe(403);
  });

  it("only sends what changed since the last sync, including deletions", async () => {
    const app = createFarm({ password: PASSWORD, store: memoryFarmStore(), log: quiet });
    const admin = await asAdmin(app);
    await admin.req("/api/fields/fld000004", { method: "PUT", json: { data: field() } });
    await admin.req("/api/fields/fld000005", { method: "PUT", json: { data: field() } });
    expect((await admin.json("/api/sync")).fields).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 30));
    const mark = new Date();
    await new Promise((r) => setTimeout(r, 30));
    await admin.req("/api/fields/fld000005", { method: "DELETE" });
    const next = await admin.json(`/api/sync?since=${encodeURIComponent(mark.toISOString())}`);
    expect(next.fields.map((f: { id: string; deleted: boolean }) => [f.id, f.deleted])).toEqual([["fld000005", true]]);
    expect(next.access).toEqual(["fld000004"]);
  });

  it("photos upload, and only people on the field can see them", async () => {
    const { owner, app } = await setup();
    await owner.req("/api/fields/fld000006", { method: "PUT", json: { data: field() } });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const { id } = await owner.json("/api/photos?field=fld000006", { method: "POST", body: jpg, headers: { "content-type": "image/jpeg" } });
    const got = await owner.req(`/api/photos/${id}`);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(jpg);
    const admin = await asAdmin(app);
    const t = await invite(admin, { kind: "app" });
    const other = phone(app);
    await other.req("/api/invites/accept", { method: "POST", json: { token: t, name: "Other" } });
    expect((await other.req(`/api/photos/${id}`)).status).toBe(404);
    expect((await owner.req("/api/photos?field=fld000006", { method: "POST", body: "hi", headers: { "content-type": "text/plain" } })).status).toBe(415);
  });

  it("Jay sees every tester and can switch one off", async () => {
    const { admin, owner } = await setup();
    await owner.req("/api/fields/fld000007", { method: "PUT", json: { data: field() } });
    const { users } = await admin.json("/api/admin/users");
    const ada = users.find((u: { name: string }) => u.name === "Ada");
    expect(ada.fields).toBe(1);
    expect((await owner.req("/api/admin/users")).status).toBe(403);
    await admin.req(`/api/admin/users/${ada.id}/disable`, { method: "POST", json: { disabled: true } });
    expect((await owner.req("/api/sync")).status).toBe(401);
  });
});

describe("merging two copies of a field", () => {
  it("keeps both phones' additions, honours deletions and keeps the syncing phone's beacon order", () => {
    const server = { f: { name: "A", lga: "Idanre" }, scouts: [{ id: "1" }, { id: "2" }], beacons: [{ id: "b1" }, { id: "b2" }], taskState: { t1: "done" }, deleted: [] };
    const incoming = { f: { name: "A2" }, scouts: [{ id: "1", health: 5 }, { id: "3" }], beacons: [{ id: "b2" }, { id: "b1" }], taskState: { t2: "doing" }, deleted: ["2"] };
    const m = mergeField(server, incoming) as any;
    expect(m.scouts).toEqual([{ id: "1", health: 5 }, { id: "3" }]);
    expect(m.beacons.map((b: { id: string }) => b.id)).toEqual(["b2", "b1"]);
    expect(m.f).toEqual({ name: "A2", lga: "Idanre" });
    expect(m.taskState).toEqual({ t1: "done", t2: "doing" });
    expect(m.deleted).toEqual(["2"]);
  });
  it("something deleted on one phone doesn't come back from another", () => {
    const m = mergeField({ records: [{ id: "r1" }], deleted: ["r1"] }, { records: [{ id: "r1" }] }) as any;
    expect(m.records).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { memoryQueue } from "./numbers-testing.js";
import { createQuoteSetup } from "./setup.js";
import type { BusinessStore, QuoteBusiness, SetupStore } from "./store.js";

const PASSWORD = "correct horse battery";
const GEM = "33333333-3333-3333-3333-333333333333";
const auth = { Authorization: `Basic ${Buffer.from(`staff:${PASSWORD}`).toString("base64")}` };
const sameSite = { ...auth, Origin: "https://bot.example.com", Host: "bot.example.com" };

const STAFF_PASSWORD = "numbers only please";
const staffAuth = { Authorization: `Basic ${Buffer.from(`tolu:${STAFF_PASSWORD}`).toString("base64")}` };

function setUp(meta: { shows?: string | null; registerFails?: boolean } = {}) {
  const q = memoryQueue([{ id: "s1", name: "Tolu", waId: "2348022222222" }]);
  const list: QuoteBusiness[] = [
    {
      id: GEM,
      name: "Glittering Gem",
      description: "jewellery",
      orderPrefix: "GG",
      phoneNumberId: null,
      ownerWaId: "2348011111111",
      businessDetails: null,
      paymentDetails: null,
      active: false,
      updatedAt: new Date(0),
    },
  ];
  const businesses: BusinessStore = {
    findByPhoneNumberId: async (n) => list.find((b) => b.phoneNumberId === n) ?? null,
    get: async (id) => list.find((b) => b.id === id) ?? null,
    list: async () => list,
  };
  const setup = {
    async updateBusiness(id: string, s: Omit<QuoteBusiness, "id" | "updatedAt">) {
      const i = list.findIndex((b) => b.id === id);
      list[i] = { ...s, id, updatedAt: new Date() };
      return list[i]!;
    },
  } as unknown as SetupStore;
  const sent: Array<{ to: string; text: string }> = [];
  const registered: Array<{ id: string; pin: string }> = [];
  const app = createQuoteSetup({
    password: PASSWORD,
    businesses,
    setup,
    reservedNumberIds: ["99999"],
    multiBusinessOn: true,
    log: { error: () => undefined },
    numbers: {
      store: q.store,
      publicUrl: "https://app.yarnoga.com",
      staffPassword: STAFF_PASSWORD,
      meta: {
        displayNumber: async () => (meta.shows === undefined ? "+234 803 123 4567" : meta.shows),
        async register(id, pin) {
          if (meta.registerFails) throw new Error("Two-step verification PIN mismatch");
          registered.push({ id, pin });
        },
      },
      send: async (to, text) => void sent.push({ to, text }),
    },
  });
  const post = (path: string, fields: Record<string, string> = {}) =>
    app.request(`/numbers/${GEM}${path}`, { method: "POST", headers: sameSite, body: new URLSearchParams(fields) });
  return { app, q, list, sent, registered, post };
}

async function withNumber() {
  const t = setUp();
  await t.q.store.open(GEM);
  await t.q.store.setNumber(GEM, "2348031234567", "s1");
  return t;
}

describe("numbers to connect", () => {
  it("lists numbers with who's doing them, behind the setup password", async () => {
    const { app } = await withNumber();
    expect((await app.request("/numbers")).status).toBe(401);
    const html = await (await app.request("/numbers", { headers: auth })).text();
    expect(html).toContain("Glittering Gem");
    expect(html).toContain("0803 123 4567");
    expect(html).toContain("Tolu");
  });

  it("walks a number through added, registered and live, and tells the owner", async () => {
    const { q, list, sent, registered, post, app } = await withNumber();
    expect((await post("/added")).status).toBe(303);
    expect(q.rows.get(GEM)?.status).toBe("added");

    expect((await post("/register", { phoneNumberId: " 1234567890 " })).status).toBe(303);
    expect(registered).toEqual([{ id: "1234567890", pin: expect.stringMatching(/^\d{6}$/) }]);
    expect(q.rows.get(GEM)).toMatchObject({ status: "registered", phoneNumberId: "1234567890", pin: registered[0]!.pin });
    expect(await (await app.request(`/numbers/${GEM}`, { headers: auth })).text()).toContain(registered[0]!.pin);

    expect((await post("/live")).status).toBe(303);
    expect(list[0]).toMatchObject({ phoneNumberId: "1234567890", active: true, name: "Glittering Gem", ownerWaId: "2348011111111" });
    expect(q.rows.get(GEM)?.status).toBe("live");
    expect(sent).toEqual([{ to: "2348011111111", text: expect.stringMatching(/\*Glittering Gem\* is live.*wa\.me\/2348031234567/s) }]);
  });

  it("refuses a Phone number ID that belongs to a different number", async () => {
    const t = setUp({ shows: "+234 809 999 9999" });
    await t.q.store.open(GEM);
    await t.q.store.setNumber(GEM, "2348031234567", null);
    const res = await t.post("/register", { phoneNumberId: "1234567890" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("belongs to +234 809 999 9999");
    expect(t.registered).toEqual([]);
  });

  it("shows WhatsApp's reason when registering fails, and keeps the status", async () => {
    const t = setUp({ registerFails: true });
    await t.q.store.open(GEM);
    await t.q.store.setNumber(GEM, "2348031234567", null);
    const res = await t.post("/register", { phoneNumberId: "1234567890" });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("PIN mismatch");
    expect(t.q.rows.get(GEM)?.status).toBe("new");
  });

  it("doesn't switch on a number that isn't registered", async () => {
    const { post, list } = await withNumber();
    expect((await post("/live")).status).toBe(400);
    expect(list[0]?.active).toBe(false);
  });

  it("messages the person a number is given to", async () => {
    const { q, post, sent } = await withNumber();
    await q.store.addStaff("Ada", "2348033333333");
    await post("/assign", { assignedTo: "s2" });
    expect(q.rows.get(GEM)?.assignedTo).toBe("s2");
    expect(sent).toEqual([{ to: "2348033333333", text: expect.stringContaining(`https://app.yarnoga.com/quote-setup/numbers/${GEM}`) }]);
  });

  it("adds and removes staff", async () => {
    const { app, q } = setUp();
    const res = await app.request("/numbers/staff", { method: "POST", headers: sameSite, body: new URLSearchParams({ name: "Ada", waId: "0803 333 3333" }) });
    expect(res.status).toBe(303);
    expect(q.team.at(-1)).toMatchObject({ name: "Ada", waId: "2348033333333" });
  });

  it("lets staff with their own password open only the numbers, not the staff list or businesses", async () => {
    const { app, q } = await withNumber();
    const list = await app.request("/numbers", { headers: staffAuth });
    expect(list.status).toBe(200);
    const html = await list.text();
    expect(html).toContain("Glittering Gem");
    expect(html).not.toContain("Who connects numbers");
    expect(html).not.toContain('href="/quote-setup"');
    expect((await app.request(`/numbers/${GEM}`, { headers: staffAuth })).status).toBe(200);
    expect((await app.request("/", { headers: staffAuth })).status).toBe(401);
    expect((await app.request(`/b/${GEM}`, { headers: staffAuth })).status).toBe(401);
    const staffHere = { ...staffAuth, Origin: "https://bot.example.com", Host: "bot.example.com" };
    const add = await app.request("/numbers/staff", { method: "POST", headers: staffHere, body: new URLSearchParams({ name: "Eve", waId: "08034444444" }) });
    expect(add.status).toBe(403);
    expect((await app.request("/numbers/staff/s1/remove", { method: "POST", headers: staffHere })).status).toBe(403);
    expect(q.team).toHaveLength(1);
    const added = await app.request(`/numbers/${GEM}/added`, { method: "POST", headers: staffHere });
    expect(added.status).toBe(303);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createMonthly } from "../products/quote/monthly.js";
import { memoryMonthlyStore } from "../products/quote/monthly-testing.js";
import { hashToken } from "./auth.js";
import { createOwnerApp } from "./index.js";
import type { Role } from "./roles.js";
import type { AppUser, UserStore } from "./store.js";
import type { AppBusiness } from "./types.js";

const BIZ = "11111111-1111-1111-1111-111111111111";
const HOST = "app.example.com";
const quiet = { info() {}, warn() {}, error() {} };

function setup() {
  const users = new Map<string, AppUser>();
  const tokens = new Map<string, string>();
  const userStore = {
    get: async (id: string) => users.get(id) ?? null,
    byWaId: async (waId: string) => [...users.values()].filter((u) => u.waId === waId),
    team: async () => [...users.values()],
    touchLogin: async () => {},
    useToken: async (hash: string) => tokens.get(hash) ?? null,
  } as unknown as UserStore;
  const now = new Date("2026-11-05T09:00:00Z");
  const m = memoryMonthlyStore(null);
  const sent: Array<{ to: string; text: string }> = [];
  const createLink = vi.fn(async () => ({ url: "https://checkout.paystack.com/first", amountKobo: 1_500_000, promo: null }));
  const monthly = createMonthly({
    store: m.store,
    payments: { createLink, chargeCard: vi.fn() },
    businessId: BIZ,
    businessName: "Iron Gym",
    subaccount: "ACCT_abc",
    feeKobo: async () => 0,
    canMessageFreely: async () => false,
    send: async (n) => {
      sent.push(n);
    },
    ownerWaId: "2348099999999",
    now: () => now,
    log: quiet,
  });
  const biz = { id: BIZ, name: "Iron Gym", orderPrefix: "IG", currency: "NGN", monthly, data: {} } as unknown as AppBusiness;
  const app = createOwnerApp({ secret: "s", publicUrl: `https://${HOST}`, users: userStore, business: async () => biz, support: { email: "support@example.com" }, now: () => now, log: quiet });
  let n = 0;
  const login = async (role: Role) => {
    n += 1;
    const u: AppUser = { id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, businessId: BIZ, waId: `2348${n}00000000`, name: null, role, passwordHash: null, sessionEpoch: 0, active: true, lastLoginAt: null };
    users.set(u.id, u);
    tokens.set(hashToken(`t-${u.id}`), u.id);
    const res = await app.request(`https://${HOST}/l/t-${u.id}`, { method: "POST", headers: { Origin: `https://${HOST}`, Host: HOST } });
    return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  };
  const post = (path: string, form: Record<string, string>, cookie: string) =>
    app.request(`https://${HOST}${path}`, {
      method: "POST",
      body: new URLSearchParams(form),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: `https://${HOST}`, Host: HOST, cookie },
    });
  const get = (path: string, cookie: string) => app.request(`https://${HOST}${path}`, { headers: { cookie, Host: HOST } });
  return { m, sent, createLink, login, post, get };
}

describe("Monthly payments page", () => {
  it("adds a plan and a customer due today, who gets the first link to send", async () => {
    const s = setup();
    const owner = await s.login("owner");
    expect((await s.post("/monthly/plan", { name: "Yoga class", price: "8,000" }, owner)).headers.get("location")).toBe("/home/monthly?msg=added");
    const res = await s.post("/monthly/member", { name: "Ada", wa: "0801 111 1111", plan: "p2", start: "2026-11-05" }, owner);
    const at = res.headers.get("location")!;
    expect(at).toMatch(/^\/home\/monthly\/m\//);
    expect(s.m.people[0]).toMatchObject({ name: "Ada", waId: "2348011111111", payDay: 5, planName: "Yoga class" });
    expect(s.createLink).toHaveBeenCalledWith(expect.objectContaining({ product: "monthly", amountKobo: 800_000, subaccount: "ACCT_abc" }));
    // The bot can't message Ada first, so the owner is given the link.
    expect(s.sent[0]).toMatchObject({ to: "2348099999999" });
    const page = await (await s.get(at.replace("/home", ""), owner)).text();
    expect(page).toContain("https://checkout.paystack.com/first");
    expect(page).toContain("https://wa.me/2348011111111?text=");
    expect(page).toContain("then the 5th of each month");
    expect(await (await s.get("/monthly", owner)).text()).toContain("₦8,000 due and not paid yet");
  });

  it("refuses a date in the past and a customer already on the plan", async () => {
    const s = setup();
    const owner = await s.login("owner");
    expect((await s.post("/monthly/member", { name: "Ada", wa: "08011111111", plan: "p1", start: "2026-11-01" }, owner)).status).toBe(400);
    await s.post("/monthly/member", { name: "Ada", wa: "08011111111", plan: "p1", start: "2026-11-20" }, owner);
    expect(s.createLink).not.toHaveBeenCalled();
    expect((await s.post("/monthly/member", { name: "Ada", wa: "08011111111", plan: "p1", start: "2026-11-20" }, owner)).status).toBe(400);
    expect(s.m.people).toHaveLength(1);
  });

  it("keeps cashiers out", async () => {
    const s = setup();
    const cashier = await s.login("cashier");
    expect(await (await s.get("/monthly", cashier)).text()).toContain("doesn't include this page");
  });
});

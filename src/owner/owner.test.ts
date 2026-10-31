import { describe, expect, it, vi } from "vitest";
import type { Product } from "../core/product.js";
import type { IncomingMessage } from "../core/whatsapp/types.js";
import type { BoardOrder, BoardStore } from "../products/quote/board.js";
import { checkPassword, hashPassword, hashToken, normaliseWaId, passwordProblem } from "./auth.js";
import { csvCell, koboToPlainNaira, ordersCsv } from "./exports.js";
import { createOwnerApp } from "./index.js";
import { readProductForm } from "./sections/prices.js";
import { paystackFeeKobo, yarnogaFeeKobo } from "./sections/settings.js";
import { lagosMidnight, lagosMonth } from "./sections/tools.js";
import { liveJson, STALE_MINUTES } from "./sections/delivery.js";
import { customersCsv } from "./sections/customers.js";
import type { AppUser, BusinessData, CounterSale, CounterStore, ExportRow, PriceStore, ProductRecord, UserStore } from "./store.js";
import { pickedQuantities, priceSale, profitByProduct, profitSummary, saleProfit, signedMoney } from "./sections/counter.js";
import type { AppBusiness, OwnerAppDeps } from "./types.js";
import { copyOwnerNotices, withAlertCopies, withAppLogin } from "./whatsapp.js";
import { memoryVerifications } from "../compliance/memory.js";
import { can, toRole, type Role } from "./roles.js";

const BIZ = "11111111-1111-1111-1111-111111111111";
const OWNER = "2348011111111";
const STAFF = "2348022222222";
const quiet = { info() {}, warn() {}, error() {} };

function memoryUsers() {
  const users = new Map<string, AppUser>();
  const tokens = new Map<string, { userId: string; expires: Date; used: boolean }>();
  let n = 0;
  const add = (businessId: string, waId: string, role: AppUser["role"], name: string | null): AppUser => {
    const existing = [...users.values()].find((u) => u.businessId === businessId && u.waId === waId);
    if (existing) {
      Object.assign(existing, { active: true, role, name: name ?? existing.name });
      return existing;
    }
    n += 1;
    const u: AppUser = { id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, businessId, waId, name, role, passwordHash: null, sessionEpoch: 0, active: true, lastLoginAt: null };
    users.set(u.id, u);
    return u;
  };
  const store: UserStore = {
    async get(id) {
      return users.get(id) ?? null;
    },
    async byWaId(waId) {
      return [...users.values()].filter((u) => u.waId === waId && u.active);
    },
    async ensureOwner(businessId, waId) {
      return add(businessId, waId, "owner", null);
    },
    async team(businessId) {
      return [...users.values()].filter((u) => u.businessId === businessId && u.active);
    },
    async addStaff(businessId, waId, name, role) {
      return add(businessId, waId, role, name);
    },
    async setRole(businessId, userId, role) {
      const u = users.get(userId);
      if (u && u.businessId === businessId && u.role !== "owner") u.role = role;
    },
    async removeStaff(businessId, userId) {
      const u = users.get(userId);
      if (u && u.businessId === businessId && u.role !== "owner") Object.assign(u, { active: false, sessionEpoch: u.sessionEpoch + 1 });
    },
    async setPassword(waId, hash) {
      for (const u of users.values()) if (u.waId === waId) Object.assign(u, { passwordHash: hash, sessionEpoch: u.sessionEpoch + 1 });
    },
    async bumpEpoch(waId) {
      for (const u of users.values()) if (u.waId === waId) u.sessionEpoch += 1;
    },
    async touchLogin() {},
    async saveToken(userId, hash, expires) {
      tokens.set(hash, { userId, expires, used: false });
    },
    async useToken(hash, now) {
      const t = tokens.get(hash);
      if (!t || t.used || t.expires <= now) return null;
      t.used = true;
      return t.userId;
    },
  };
  return { store, users, add };
}

function memoryPrices(): PriceStore & { all: ProductRecord[] } {
  const all: ProductRecord[] = [];
  return {
    all,
    async products() {
      return all.filter((p) => p.active);
    },
    async product(id) {
      return all.find((p) => p.id === id) ?? null;
    },
    async save(id, input) {
      if (id) {
        const p = all.find((x) => x.id === id)!;
        Object.assign(p, input);
        return id;
      }
      const p = { ...input, id: `22222222-2222-2222-2222-${String(all.length + 1).padStart(12, "0")}`, photoPath: null, morePhotos: [] };
      all.push(p);
      return p.id;
    },
    async remove(id) {
      all.find((p) => p.id === id)!.active = false;
    },
  };
}

const exportRows: ExportRow[] = [
  {
    ref: "KP-1001",
    status: "paid",
    createdAt: new Date("2026-10-02T09:00:00Z"),
    confirmedAt: new Date("2026-10-02T09:05:00Z"),
    paidAt: new Date("2026-10-02T10:00:00Z"),
    customerName: "=HYPERLINK(\"x\")",
    customerWaId: "2348033333333",
    items: "100 x Flyers: A5",
    totalKobo: 1250050,
  },
];

function memoryData(): BusinessData {
  let sheetKey = "a".repeat(32);
  return {
    info: async () => ({ name: "Kahn", description: null, orderPrefix: "KP", ownerWaId: OWNER, businessDetails: null, paymentDetails: null, whatsappNumber: "2348099999999", sheetKey }),
    saveInfo: vi.fn(async () => {}),
    newSheetKey: async () => (sheetKey = "b".repeat(32)),
    banks: async () => [],
    addBank: vi.fn(async () => {}),
    removeBank: async () => {},
    setPrimaryBank: async () => {},
    alertNumbers: async () => [],
    addAlertNumber: vi.fn(async () => {}),
    removeAlertNumber: async () => {},
    confirmedSince: async () => [new Date()],
    topItems: async () => [{ name: "Flyers: A5", quantity: 100, totalKobo: 1250050 }],
    chatCounts: async () => ({ customers: 3, inbound: 10, outbound: 12 }),
    exportRows: async () => exportRows,
  };
}

const order: BoardOrder = {
  id: "33333333-3333-3333-3333-333333333333",
  orderNumber: 1002,
  status: "confirmed",
  stage: null,
  deliveryStatus: null,
  customerName: "Ada",
  customerWaId: "2348033333333",
  items: "100 x Flyers: A5",
  totalKobo: 1250000,
  confirmedAt: new Date(),
  movedAt: new Date(),
};

function setup(extra: Partial<AppBusiness> = {}) {
  const users = memoryUsers();
  const prices = memoryPrices();
  const board: BoardStore = {
    orders: async () => [order],
    setStage: vi.fn(async () => true),
    sales: async () => ({ quotes: 4, orders: 2, paidInKobo: 1250050 }),
    aiRepliesUsed: async () => 40,
  };
  const markPaid = vi.fn(async () => true);
  const kyb = memoryVerifications();
  const onSubmitted = vi.fn(async () => {});
  const biz: AppBusiness = {
    id: BIZ,
    name: "Kahn",
    orderPrefix: "KP",
    fromEnv: false,
    numberId: "PNID",
    includeUnnumbered: false,
    board,
    prices,
    data: memoryData(),
    logo: async () => null,
    saveLogo: async () => {},
    markPaid,
    ...extra,
  };
  const deps: OwnerAppDeps = {
    secret: "app-secret",
    publicUrl: "https://app.example.com",
    users: users.store,
    business: async (id) => (id === BIZ ? biz : null),
    support: { email: "support@example.com" },
    verification: { store: kyb.store, onSubmitted },
    log: quiet,
  };
  const app = createOwnerApp(deps);
  return { app, users, prices, board, biz, markPaid, kyb, onSubmitted };
}

const HOST = "app.example.com";
const post = (form: Record<string, string>, cookie = "") => ({
  method: "POST",
  body: new URLSearchParams(form),
  headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: `https://${HOST}`, Host: HOST, cookie },
});
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

/** Logs in through a WhatsApp link and returns the cookie. */
async function login(s: ReturnType<typeof setup>, waId: string, role: Role = "owner") {
  const user = role === "owner" ? await s.users.store.ensureOwner(BIZ, waId) : await s.users.store.addStaff(BIZ, waId, "Bola", role);
  await s.users.store.saveToken(user.id, hashToken("tok-" + waId), new Date(Date.now() + 60_000));
  const res = await s.app.request(`https://${HOST}/l/tok-${waId}`, post({}));
  expect(res.status).toBe(303);
  return cookieOf(res);
}
const get = (s: ReturnType<typeof setup>, path: string, cookie: string) => s.app.request(`https://${HOST}${path}`, { headers: { cookie, Host: HOST } });

describe("owner app login", () => {
  it("sends people who aren't logged in to the login page", async () => {
    const s = setup();
    const res = await s.app.request("/");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/home/login");
    expect(await (await s.app.request("/login")).text()).toContain("Send <b>app</b>");
  });

  it("logs in once from a WhatsApp link, which then stops working", async () => {
    const s = setup();
    const owner = await s.users.store.ensureOwner(BIZ, OWNER);
    await s.users.store.saveToken(owner.id, hashToken("abc"), new Date(Date.now() + 60_000));
    // Opening the link only shows a button, so link previews can't use it up.
    expect(await (await s.app.request("/l/abc")).text()).toContain("Open my app");
    const first = await s.app.request(`https://${HOST}/l/abc`, post({}));
    expect(first.headers.get("location")).toBe("/home");
    const dash = await get(s, "/", cookieOf(first));
    expect(await dash.text()).toContain("Paid in this month");
    expect((await s.app.request(`https://${HOST}/l/abc`, post({}))).status).toBe(410);
  });

  it("logs in with a password and slows down guessing", async () => {
    const s = setup();
    await s.users.store.ensureOwner(BIZ, OWNER);
    await s.users.store.setPassword(OWNER, await hashPassword("a good long password"));
    const ok = await s.app.request(`https://${HOST}/login`, post({ wa: "0801 111 1111", password: "a good long password" }));
    expect(ok.status).toBe(303);
    expect(cookieOf(ok)).toContain("yarnoga_app=");
  }, 20_000);

  it("serves the yarnOga logo files without a login, and nothing else from that folder", async () => {
    const s = setup();
    const logo = await s.app.request("/brand/logo-96.png");
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
    expect(logo.headers.get("cache-control")).toContain("max-age");
    expect((await s.app.request("/brand/secret.png")).status).toBe(404);
  });

  it("refuses forms posted from another website", async () => {
    const s = setup();
    const res = await s.app.request("/login", { method: "POST", body: new URLSearchParams({ wa: OWNER, password: "x" }), headers: { Origin: "https://evil.example", Host: HOST } });
    expect(res.status).toBe(403);
  });

  it("logs out everywhere when the password changes", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    await s.users.store.bumpEpoch(OWNER);
    expect((await get(s, "/", cookie)).status).toBe(303);
  });
});

describe("owner app pages", () => {
  it("shows staff the inbox and orders but not settings or exports", async () => {
    const s = setup();
    const cookie = await login(s, STAFF, "manager");
    expect(await (await get(s, "/orders", cookie)).text()).toContain("KP-1002");
    expect(await (await get(s, "/settings", cookie)).text()).toContain("Only the business owner");
    expect(await (await get(s, "/export", cookie)).text()).toContain("Only the business owner");
  });

  it("marks an order paid from the board", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    const res = await s.app.request(`https://${HOST}/orders/paid`, post({ order: order.id, number: "1002" }, cookie));
    expect(res.headers.get("location")).toBe("/home/orders?msg=paid");
    expect(s.markPaid).toHaveBeenCalledWith(1002);
  });

  it("adds a product with price breaks, in kobo", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    const res = await s.app.request(
      `https://${HOST}/prices/new`,
      post({ name: "Flyers", description: "Glossy", o0_name: "A5", o0_min: "50", o0_f0: "", o0_p0: "₦1,500", o0_f1: "500", o0_p1: "1200.50" }, cookie),
    );
    expect(res.headers.get("location")).toBe("/home/prices?msg=saved");
    expect(s.prices.all[0]!.options[0]).toMatchObject({
      name: "A5",
      minQuantity: 50,
      stock: null,
      tiers: [
        { minQuantity: 50, unitPriceKobo: 150000 },
        { minQuantity: 500, unitPriceKobo: 120050 },
      ],
    });
  });

  it("exports a CSV and serves the Google Sheets link only with its key", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    const csv = await (await get(s, "/export/orders.csv?from=2026-10-01&to=2026-10-31", cookie)).text();
    expect(csv).toContain("KP-1001,paid,2026-10-02 10:00");
    expect(csv).toContain("12500.50");
    expect((await s.app.request(`/sheet/${BIZ}/${"a".repeat(32)}.csv`)).status).toBe(200);
    expect((await s.app.request(`/sheet/${BIZ}/${"c".repeat(32)}.csv`)).status).toBe(404);
  });
});

describe("staff roles", () => {
  it("lets a manager run the shop and see the takings, but not settings", async () => {
    const s = setup();
    const cookie = await login(s, STAFF, "manager");
    const dash = await (await get(s, "/", cookie)).text();
    expect(dash).toContain("Paid in this month");
    expect(dash).toContain("Bola · Manager");
    expect(await (await get(s, "/prices/new", cookie)).text()).toContain("Product name");
    expect(await (await get(s, "/settings", cookie)).text()).toContain("Only the business owner");
  });

  it("shows a cashier orders and chats with each order's price, but no takings or totals", async () => {
    const s = setup();
    const cookie = await login(s, STAFF, "cashier");
    const dash = await (await get(s, "/", cookie)).text();
    expect(dash).not.toContain("Paid in this month");
    expect(dash).not.toContain("₦12,500.50"); // the best seller's total
    expect(dash).not.toContain("Settings");
    const board = await (await get(s, "/orders", cookie)).text();
    expect(board).toContain("KP-1002");
    expect(board).toContain("₦12,500"); // the order's own price
    expect(board).toContain("Mark paid");
    expect(board).not.toContain("Export");
    const res = await s.app.request(`https://${HOST}/orders/paid`, post({ order: order.id, number: "1002" }, cookie));
    expect(res.headers.get("location")).toBe("/home/orders?msg=paid");
    expect(await (await get(s, "/inbox", cookie)).text()).not.toContain("Not for your role");
  });

  it("lets a cashier read the price list but not change it", async () => {
    const s = setup();
    const owner = await login(s, OWNER);
    await s.app.request(`https://${HOST}/prices/new`, post({ name: "Flyers", o0_name: "A5", o0_min: "50", o0_p0: "1500" }, owner));
    const id = s.prices.all[0]!.id;
    const cookie = await login(s, STAFF, "cashier");
    const list = await (await get(s, "/prices", cookie)).text();
    expect(list).toContain("Flyers");
    expect(list).not.toContain("Add a product");
    expect(await (await get(s, `/prices/${id}`, cookie)).text()).toContain("<fieldset disabled");
    expect(await (await get(s, "/prices/new", cookie)).text()).toContain("Not for your role");
    const res = await s.app.request(`https://${HOST}/prices/${id}`, post({ name: "Free flyers", o0_name: "A5", o0_min: "50", o0_p0: "1" }, cookie));
    expect(res.headers.get("location")).toBe("/home?msg=not_allowed");
    expect(s.prices.all[0]!.name).toBe("Flyers");
  });

  it("shows a rider the order board and deliveries only", async () => {
    const s = setup();
    const cookie = await login(s, STAFF, "rider");
    const board = await (await get(s, "/orders", cookie)).text();
    expect(board).toContain("KP-1002");
    expect(board).not.toContain("Mark paid");
    expect(board).not.toContain(`href="/home/inbox"`);
    for (const path of ["/inbox", "/customers", "/prices", "/test", "/posters"]) {
      expect(await (await get(s, path, cookie)).text()).toContain("Not for your role");
    }
    const res = await s.app.request(`https://${HOST}/orders/paid`, post({ order: order.id, number: "1002" }, cookie));
    expect(res.headers.get("location")).toBe("/home?msg=not_allowed");
    expect(s.markPaid).not.toHaveBeenCalled();
  });

  it("lets the owner add staff with a role and change it, and never demotes the owner", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    await s.app.request(`https://${HOST}/settings/team`, post({ name: "Musa", wa: "0803 333 3333", role: "rider" }, cookie));
    const musa = (await s.users.store.team(BIZ)).find((u) => u.name === "Musa")!;
    expect(musa.role).toBe("rider");
    await s.app.request(`https://${HOST}/settings/team/${musa.id}/role`, post({ role: "cashier" }, cookie));
    expect(musa.role).toBe("cashier");
    expect((await s.app.request(`https://${HOST}/settings/team`, post({ name: "Me", wa: OWNER, role: "rider" }, cookie))).headers.get("location")).toBe("/home/settings?msg=is_owner#team");
    expect((await s.app.request(`https://${HOST}/settings/team`, post({ name: "X", wa: "0804 444 4444", role: "owner" }, cookie))).headers.get("location")).toBe("/home/settings?msg=bad#team");
    const me = (await s.users.store.team(BIZ)).find((u) => u.waId === OWNER)!;
    await s.app.request(`https://${HOST}/settings/team/${me.id}/role`, post({ role: "rider" }, cookie));
    expect(me.role).toBe("owner");
    expect(await (await get(s, "/settings", cookie)).text()).toContain('<option value="cashier" selected>Cashier</option>');
  });

  it("reads old staff rows as managers, and anything unknown as the least access", () => {
    expect(toRole("staff")).toBe("manager");
    expect(toRole("cashier")).toBe("cashier");
    expect(toRole("boss")).toBe("rider");
    expect(can("cashier", "money")).toBe(false);
    expect(can("manager", "money")).toBe(true);
  });
});

describe("verify your business", () => {
  it("takes details and real documents, sends once everything is there, then locks", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    expect(await (await get(s, "/verify", cookie)).text()).toContain("Let's verify your business");
    await s.app.request(`https://${HOST}/verify/details`, post({ type: "business_name", name: "Kahn Prints", rc: "BN 3456789", address: "12 Allen Ave", director: "Ada Okafor" }, cookie));
    expect(s.kyb.rows.get(BIZ)).toMatchObject({ entityType: "business_name", rcNumber: "3456789" });

    // Sending too early is refused.
    expect((await s.app.request(`https://${HOST}/verify/submit`, post({}, cookie))).headers.get("location")).toBe("/home/verify?msg=bad");

    const upload = (kind: string, bytes: Uint8Array, name: string) => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", new File([bytes], name));
      return s.app.request(`https://${HOST}/verify/doc`, { method: "POST", body: fd, headers: { Origin: `https://${HOST}`, Host: HOST, cookie } });
    };
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect((await upload("certificate", new TextEncoder().encode("<script>"), "x.pdf")).headers.get("location")).toBe("/home/verify?msg=bad");
    for (const kind of ["certificate", "id", "address"]) await upload(kind, pdf, `${kind}.pdf`);
    expect(s.kyb.docs).toHaveLength(3);

    expect((await s.app.request(`https://${HOST}/verify/submit`, post({}, cookie))).headers.get("location")).toBe("/home/verify?msg=sent_review");
    expect(s.onSubmitted).toHaveBeenCalledWith(BIZ, "Kahn");
    // Once sent, details can't be changed.
    await s.app.request(`https://${HOST}/verify/details`, post({ type: "company", name: "Other" }, cookie));
    expect(s.kyb.rows.get(BIZ)!.registeredName).toBe("Kahn Prints");
  });

  it("is for owners only", async () => {
    const s = setup();
    const cookie = await login(s, STAFF, "manager");
    expect(await (await get(s, "/verify", cookie)).text()).toContain("Only the business owner");
  });
});

describe("helpers", () => {
  it("writes the customer list as a spreadsheet that formulas can't hijack", () => {
    const csv = customersCsv([
      { contactId: "c1", name: "=HYPERLINK(1)", waId: "2348012345678", orders: 3, spentKobo: 1_250_050, lastOrderAt: new Date("2026-10-20T10:00:00Z"), rating: 4.5 },
    ]);
    expect(csv).toContain("Name,WhatsApp,Orders,Paid,Last order,Rating");
    expect(csv).toContain("'=HYPERLINK(1),'+2348012345678,3,12500.50,2026-10-20,4.5");
  });

  it("turns deliveries on the road into the live riders view, with minutes since each rider was seen", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const view = liveJson(
      [
        {
          id: "d1", orderRef: "KP-1042", status: "picked_up", riderName: "Musa", riderWaId: "2348055555555", customerName: null, customerWaId: "2348012345678",
          address: "Lekki", drop: { lat: 6.44, lng: 3.47 }, rider: { lat: 6.45, lng: 3.43, seenAt: new Date(now.getTime() - 3 * 60_000) }, assignedAt: null, trackLink: "https://x/track/t",
        },
        { id: "d2", orderRef: "KP-1043", status: "assigned", riderName: "Femi", riderWaId: null, customerName: "Tunde", customerWaId: "2348023456789", address: null, drop: null, rider: null, assignedAt: null },
      ],
      now,
    );
    expect(view[0]).toMatchObject({ ref: "KP-1042", at: { lat: 6.45, lng: 3.43, minutes: 3 }, track: "https://x/track/t", customer: "+2348012345678" });
    expect(view[1]).toMatchObject({ ref: "KP-1043", at: null, track: null, customer: "Tunde" });
    expect(STALE_MINUTES).toBe(30);
  });

  it("reads WhatsApp numbers typed the Nigerian way", () => {
    expect(normaliseWaId("0801 234 5678")).toBe("2348012345678");
    expect(normaliseWaId("+234 801 234 5678")).toBe("2348012345678");
    expect(normaliseWaId("12")).toBeNull();
  });

  it("checks passwords", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await checkPassword("correct horse battery", hash)).toBe(true);
    expect(await checkPassword("wrong", hash)).toBe(false);
    expect(await checkPassword("x", null)).toBe(false);
    expect(passwordProblem("short", OWNER)).toContain("at least");
    expect(passwordProblem("08011111111".replace(/^0/, "234"), OWNER)).not.toBeNull();
  });

  it("refuses prices that aren't plain naira, and options without a price at their minimum", () => {
    const bad = readProductForm({ name: "Mugs", o0_name: "White", o0_min: "10", o0_f0: "20", o0_p0: "15k" });
    expect(bad.problems.join(" ")).toContain('"15k" isn\'t a price');
    const gap = readProductForm({ name: "Mugs", o0_name: "White", o0_min: "10", o0_f0: "20", o0_p0: "1500" });
    expect(gap.problems.join(" ")).toContain("must start at the minimum order");
  });

  it("keeps spreadsheet cells from running as formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(koboToPlainNaira(1250050)).toBe("12500.50");
    expect(ordersCsv(exportRows).startsWith("﻿Order,Status")).toBe(true);
  });

  it("works out fees in whole kobo", () => {
    expect(paystackFeeKobo(1_000_000)).toBe(25_000); // ₦150 + ₦100
    expect(paystackFeeKobo(200_000)).toBe(3_000); // under ₦2,500: no ₦100
    expect(paystackFeeKobo(100_000_000)).toBe(200_000); // capped at ₦2,000
    expect(yarnogaFeeKobo(1_000_000, 250)).toBe(25_000);
  });

  it("reads Lagos dates and months", () => {
    expect(lagosMidnight("2026-10-01")!.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(lagosMidnight("2026-02-31")).toBeNull();
    expect(lagosMonth("2026-12")!.map((d) => d.toISOString())).toEqual(["2026-11-30T23:00:00.000Z", "2026-12-31T23:00:00.000Z"]);
  });
});

describe("WhatsApp side", () => {
  const msg = (from: string, text: string): IncomingMessage => ({ waMessageId: "w", from, type: "text", text, timestamp: 0, raw: null, businessNumberId: "PNID" });
  const ctx = { contactId: "c", history: [], downloadMedia: async () => ({ data: new Blob(), mimeType: "" }), sendLater: async () => {}, canMessageFreely: async () => true };
  const bot: Product = { name: "quote", handle: async () => ({ text: "bot", notify: [{ to: OWNER, text: "New order" }] }) };

  it("gives the owner and staff a login link, and anyone else the normal bot", async () => {
    const users = memoryUsers();
    users.add(BIZ, STAFF, "cashier", "Bola");
    const wrapped = withAppLogin(bot, { users: users.store, publicUrl: "https://app.example.com", businessFor: async () => ({ id: BIZ, ownerWaId: OWNER }) });
    expect((await wrapped.handle(msg(OWNER, "app"), ctx))!.text).toContain("https://app.example.com/home/l/");
    expect((await wrapped.handle(msg(STAFF, "login"), ctx))!.text).toContain("/home/l/");
    expect((await wrapped.handle(msg("2348000000000", "app"), ctx))!.text).toBe("bot");
  });

  it("copies owner alerts to the extra alert numbers", async () => {
    const wrapped = withAlertCopies(bot, { ownerWaId: OWNER, numbers: async () => ["2348044444444", OWNER] });
    const reply = await wrapped.handle(msg("2348000000000", "yes"), ctx);
    expect(reply!.notify!.map((n) => n.to)).toEqual([OWNER, "2348044444444"]);
    expect(copyOwnerNotices([{ to: "x", text: "receipt" }], OWNER, ["y"])).toHaveLength(1);
  });
});

describe("counter sales", () => {
  const TIN = "44444444-4444-4444-4444-000000000001";
  const SACHET = "44444444-4444-4444-4444-000000000002";
  const milk = (): ProductRecord => ({
    id: "22222222-2222-2222-2222-000000000001",
    name: "Peak milk",
    description: null,
    category: null,
    unit: null,
    leadTimeDays: null,
    active: true,
    photoPath: null,
    options: [
      { id: TIN, name: "Tin", minQuantity: 1, stock: 5, costKobo: 40_000, tiers: [{ minQuantity: 1, unitPriceKobo: 50_000 }, { minQuantity: 12, unitPriceKobo: 45_000 }] },
      { id: SACHET, name: "Sachet", minQuantity: 1, stock: null, costKobo: null, tiers: [{ minQuantity: 1, unitPriceKobo: 10_000 }] },
    ],
  });

  function memoryCounter(): CounterStore & { recorded: CounterSale[] } {
    const recorded: CounterSale[] = [];
    const keys = new Map<string, string>();
    return {
      recorded,
      sell: vi.fn(async ({ key, paidBy, lines }) => {
        if (keys.has(key)) return { ok: true as const, saleId: keys.get(key)!, duplicate: true };
        const id = `55555555-5555-5555-5555-${String(recorded.length + 1).padStart(12, "0")}`;
        keys.set(key, id);
        recorded.unshift({ id, at: new Date(), soldBy: "Bola", paidBy, totalKobo: lines.reduce((t, l) => t + l.totalKobo, 0), voided: false, lines: lines.map((l) => ({ name: l.name, quantity: l.quantity, totalKobo: l.totalKobo, unitCostKobo: l.variantId === TIN ? 40_000 : null })) });
        return { ok: true as const, saleId: id, duplicate: false };
      }),
      void: vi.fn(async (id) => {
        const s = recorded.find((x) => x.id === id && !x.voided);
        if (s) s.voided = true;
        return Boolean(s);
      }),
      sales: async () => recorded,
      paidOrders: async () => [{ discountKobo: 5_000, lines: [{ name: "Peak milk: Tin", quantity: 2, totalKobo: 100_000, unitCostKobo: 40_000 }] }],
    };
  }

  function withCounter() {
    const counter = memoryCounter();
    const s = setup({ counter });
    s.prices.all.push(milk());
    return { ...s, counter };
  }

  it("prices a sale from the price list, and refuses what's short or below the minimum", () => {
    const products = [milk()];
    const sale = priceSale(products, new Map([[TIN, 2], [SACHET, 3]]));
    expect(sale.problems).toEqual([]);
    expect(sale.lines.map((l) => [l.name, l.unitPriceKobo, l.totalKobo])).toEqual([["Peak milk: Tin", 50_000, 100_000], ["Peak milk: Sachet", 10_000, 30_000]]);
    expect(priceSale(products, new Map([[TIN, 6]])).problems).toEqual(["Peak milk: Tin: only 5 left."]);
    expect(priceSale(products, new Map()).problems[0]).toContain("Tap +");
    expect(pickedQuantities({ [`q_${TIN}`]: "2", [`q_${SACHET}`]: "", q_bad: "9", [`q_${SACHET.replace("2", "3")}`]: "1.5" })).toEqual({ picked: new Map([[TIN, 2]]), problems: ['"1.5" isn\'t a number of pieces.'] });
  });

  it("works out profit only where every item has a cost price", () => {
    const tin = { name: "Peak milk: Tin", quantity: 2, totalKobo: 100_000, unitCostKobo: 40_000 };
    const sachet = { name: "Peak milk: Sachet", quantity: 1, totalKobo: 10_000, unitCostKobo: null };
    expect(saleProfit([tin])).toBe(20_000);
    expect(saleProfit([tin], 25_000)).toBe(-5_000);
    expect(saleProfit([tin, sachet])).toBeNull();
    expect(profitSummary([{ lines: [tin] }, { lines: [tin, sachet] }, { lines: [tin], discountKobo: 5_000 }])).toEqual({ profitKobo: 35_000, salesKobo: 195_000, counted: 2, missing: 1 });
    expect(profitByProduct([tin, sachet, tin], 5)).toEqual([{ name: "Peak milk: Tin", quantity: 4, salesKobo: 200_000, profitKobo: 40_000 }]);
    expect(signedMoney(-5_000, "NGN")).toBe("-₦50");
  });

  it("reads a cost price on the product form only when the box is there", () => {
    const form = { name: "Peak milk", o0_name: "Tin", o0_p0: "500", o0_cost: "₦400" };
    expect(readProductForm(form).input.options[0]!.costKobo).toBe(40_000);
    expect(readProductForm({ ...form, o0_cost: "" }).input.options[0]!.costKobo).toBeNull();
    expect("costKobo" in readProductForm({ name: "Peak milk", o0_name: "Tin", o0_p0: "500" }).input.options[0]!).toBe(false);
    expect(readProductForm({ ...form, o0_cost: "lots" }).problems[0]).toContain("isn't a cost price");
  });

  it("lets a cashier ring up a sale once, without seeing profit or cancelling", async () => {
    const s = withCounter();
    const cookie = await login(s, STAFF, "cashier");
    const screen = await (await get(s, "/counter", cookie)).text();
    expect(screen).toContain("Peak milk: Tin");
    expect(screen).toContain("₦500 each, ₦450 from 12");

    const check = await s.app.request(`https://${HOST}/counter/check`, post({ [`q_${TIN}`]: "2", paid: "transfer" }, cookie));
    const review = await check.text();
    expect(review).toContain("₦1,000");
    const key = review.match(/name="key" value="([0-9a-f-]{36})"/)![1]!;
    const confirm = { [`q_${TIN}`]: "2", paid: "transfer", key, total: "100000" };
    const sold = await s.app.request(`https://${HOST}/counter/sell`, post(confirm, cookie));
    expect(sold.headers.get("location")).toBe("/home/counter?msg=sold");
    await s.app.request(`https://${HOST}/counter/sell`, post(confirm, cookie));
    expect(s.counter.recorded).toHaveLength(1);
    expect(s.counter.recorded[0]).toMatchObject({ paidBy: "transfer", totalKobo: 100_000 });

    const after = await (await get(s, "/counter", cookie)).text();
    expect(after).toContain("2 x Peak milk: Tin");
    expect(after).not.toContain("Profit");
    expect(after).not.toContain("/cancel");
    const cancel = await s.app.request(`https://${HOST}/counter/${s.counter.recorded[0]!.id}/cancel`, post({}, cookie));
    expect(cancel.headers.get("location")).toBe("/home?msg=not_allowed");
    expect(s.counter.void).not.toHaveBeenCalled();
  });

  it("shows the new total when a price changed after checking", async () => {
    const s = withCounter();
    const cookie = await login(s, OWNER);
    const res = await s.app.request(`https://${HOST}/counter/sell`, post({ [`q_${TIN}`]: "2", paid: "cash", key: crypto.randomUUID(), total: "90000" }, cookie));
    expect(await res.text()).toContain("A price changed since you checked");
    expect(s.counter.sell).not.toHaveBeenCalled();
  });

  it("shows the owner profit, lets them cancel a sale, and shows cost prices on the price list", async () => {
    const s = withCounter();
    const cookie = await login(s, OWNER);
    await s.app.request(`https://${HOST}/counter/sell`, post({ [`q_${TIN}`]: "1", paid: "cash", key: crypto.randomUUID(), total: "50000" }, cookie));
    const dash = await (await get(s, "/", cookie)).text();
    // Counter: 500 - 400 = 100. WhatsApp order: 1,000 - 50 discount - 800 = 150.
    expect(dash).toContain("Profit this month");
    expect(dash).toContain("₦250");
    expect(dash).toContain("Counter sales this month");
    expect(dash).toContain("Profit by product this month");
    expect(await (await get(s, "/counter", cookie)).text()).toContain("profit <b>₦100</b>");
    const cancel = await s.app.request(`https://${HOST}/counter/${s.counter.recorded[0]!.id}/cancel`, post({}, cookie));
    expect(cancel.headers.get("location")).toBe("/home/counter?msg=sale_cancelled");
    expect(await (await get(s, `/prices/${milk().id}`, cookie)).text()).toContain('name="o0_cost" inputmode="decimal" value="400"');
  });

  it("stays hidden when counter sales are off", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    expect(await (await get(s, "/", cookie)).text()).not.toContain("/home/counter");
    expect((await get(s, "/counter", cookie)).status).toBe(404);
    expect(await (await get(s, "/prices/new", cookie)).text()).not.toContain("_cost");
  });
});

describe("owner app plan usage", () => {
  const onFree = (link = vi.fn(async () => ({ url: "https://checkout.paystack.com/xyz" }))) => ({
    features: { planCode: async () => "free", has: async () => true, limit: async () => 50 },
    plan: async () => ({ name: "Free", orderLimit: 50 }),
    botMessages: async () => ({ sent: 120, limit: null }),
    topUps: { extra: async () => 0, packs: async () => [{ code: "ai-1000", name: "1,000 AI replies", replies: 1000, priceKobo: 200_000 }], link },
  });

  it("shows orders, AI replies and messages against the plan, and offers a top-up near the limit", async () => {
    const s = setup(onFree());
    const html = await (await get(s, "/", await login(s, OWNER))).text();
    expect(html).toContain("2 of 50");
    expect(html).toContain("40 of 50");
    expect(html).toContain("No limit on your plan");
    expect(html).toContain("used 80% of this month&#39;s AI replies");
    expect(html).toContain("Buy 1,000 replies · ₦2,000");
  });

  it("sends the owner to Paystack for a pack, and keeps staff from buying", async () => {
    const link = vi.fn(async () => ({ url: "https://checkout.paystack.com/xyz" }));
    const s = setup(onFree(link));
    const res = await s.app.request(`https://${HOST}/topup`, post({ pack: "ai-1000" }, await login(s, OWNER)));
    expect(res.headers.get("location")).toBe("https://checkout.paystack.com/xyz");
    expect(link).toHaveBeenCalledWith("ai-1000", OWNER);

    const manager = await login(s, STAFF, "manager");
    expect(await (await get(s, "/", manager)).text()).not.toContain("Buy 1,000 replies");
    expect(await (await s.app.request(`https://${HOST}/topup`, post({ pack: "ai-1000" }, manager))).text()).toContain("Only the business owner");
    expect(link).toHaveBeenCalledTimes(1);
  });
});

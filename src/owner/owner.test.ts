import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "../core/product.js";
import type { IncomingMessage } from "../core/whatsapp/types.js";
import type { BoardOrder, BoardStore } from "../products/quote/board.js";
import { checkPassword, hashPassword, hashToken, normaliseWaId, passwordProblem } from "./auth.js";
import { csvCell, koboToPlainNaira, ordersCsv } from "./exports.js";
import { createOwnerApp } from "./index.js";
import { barcodesTaken, readProductForm } from "./sections/prices.js";
import { MATCH_JS } from "./sections/photos.js";
import { BARCODE_KEY_JS, barcodeKey } from "./scanner.js";
import { paystackFeeKobo, yarnogaFeeKobo } from "./sections/settings.js";
import { flyerNumber, flyerPrice } from "./sections/flyers.js";
import { lagosMidnight, lagosMonth } from "./sections/tools.js";
import { taxCsv, taxMonths, taxTotal, vatInside, yearMonths } from "./sections/tax.js";
import { withOrders } from "./sections/ads.js";
import { summariseAds } from "../core/ads.js";
import { liveJson, STALE_MINUTES } from "./sections/delivery.js";
import { customersCsv } from "./sections/customers.js";
import type { AppUser, BusinessData, CounterSale, CounterStore, ExportRow, PriceStore, ProductRecord, UserStore } from "./store.js";
import { pickedQuantities, priceSale, profitByProduct, profitSummary, saleProfit, signedMoney } from "./sections/counter.js";
import { readTillSale } from "./sections/till.js";
import type { AppBusiness, OwnerAppDeps } from "./types.js";
import { copyOwnerNotices, withAlertCopies, withAppLogin } from "./whatsapp.js";
import { memoryVerifications } from "../compliance/memory.js";
import { memoryCustomerFiles } from "../products/quote/customer-files.js";
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

function setup(extra: Partial<AppBusiness> = {}, more: Partial<OwnerAppDeps> = {}) {
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
    verification: { store: kyb.store, onSubmitted, payLinkLimits: () => true },
    log: quiet,
    ...more,
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

  it("goes back to the page a link opened, such as a chat from an owner alert, after logging in", async () => {
    const s = setup();
    const site = new Hono().route("/home", s.app);
    const chat = `/home/inbox/${BIZ}?b=${BIZ}`;
    const res = await site.request(`https://${HOST}${chat}`);
    expect(res.headers.get("location")).toBe(`/home/login?next=${encodeURIComponent(chat)}`);
    expect(await (await site.request(`https://${HOST}${res.headers.get("location")}`)).text()).toContain(`name="next" value="${chat.replace("&", "&amp;")}"`);

    await s.users.store.ensureOwner(BIZ, OWNER);
    await s.users.store.setPassword(OWNER, await hashPassword("a good long password"));
    const form = { wa: "0801 111 1111", password: "a good long password" };
    expect((await s.app.request(`https://${HOST}/login`, post({ ...form, next: chat }))).headers.get("location")).toBe(chat);
    expect((await s.app.request(`https://${HOST}/login`, post({ ...form, next: "https://evil.example/home/" }))).headers.get("location")).toBe("/home");
    expect((await s.app.request(`https://${HOST}/login`, post({ ...form, next: "/home//evil.example" }))).headers.get("location")).toBe("/home");
  }, 20_000);

  it("switches to the business a link names when the person runs more than one", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    const s = setup({}, { business: async (id) => (id === BIZ ? s.biz : id === OTHER ? { ...s.biz, id: OTHER, name: "Demo Shop" } : null) });
    const cookie = await login(s, OWNER);
    await s.users.store.ensureOwner(OTHER, OWNER);
    const switched = await get(s, `/?b=${OTHER}`, cookie);
    expect(await switched.text()).toContain("Demo Shop");
    expect(await (await get(s, "/", cookieOf(switched))).text()).toContain("Demo Shop");
    // A business they don't belong to changes nothing.
    const stranger = await get(s, "/?b=33333333-3333-3333-3333-333333333333", cookie);
    expect(stranger.headers.get("set-cookie")).toBeNull();
  });

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
    await s.app.request(`https://${HOST}/verify/details`, post({ type: "business_name", name: "Kahn Prints", rc: "BN 3456789", address: "12 Allen Ave", director: "Ada Okafor", pep: "no" }, cookie));
    expect(s.kyb.rows.get(BIZ)).toMatchObject({ entityType: "business_name", rcNumber: "3456789", pep: false });

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

  it("says verifying lifts the pay-link limits", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    expect(await (await get(s, "/verify", cookie)).text()).toContain("pay links take up to ₦200,000 a payment and ₦1,000,000 a month");
    await s.kyb.store.saveDetails(BIZ, { entityType: "individual", registeredName: "Kahn Prints", rcNumber: null, tin: null, address: "x", directorName: "Ada Okafor", contactEmail: null, pep: false });
    await s.kyb.store.review(BIZ, "approved", null, "jay");
    expect(await (await get(s, "/verify", cookie)).text()).toContain("no yarnOga limit");

    // Money going to someone else's account keeps the limits on.
    s.biz.data.banks = async () => [{ id: "a1", bankName: "GTBank", bankCode: "058", accountNumber: "0123456789", accountName: "JOHN DOE", isPrimary: true }];
    expect(await (await get(s, "/verify", cookie)).text()).toContain("isn't your verified business or owner name");
    s.biz.data.banks = async () => [{ id: "a1", bankName: "GTBank", bankCode: "058", accountNumber: "0123456789", accountName: "OKAFOR ADA", isPrimary: true }];
    expect(await (await get(s, "/verify", cookie)).text()).toContain("no yarnOga limit");

    await s.kyb.store.setPaused(BIZ, true, "Reviewing recent payments.", "jay");
    const paused = await (await get(s, "/verify", cookie)).text();
    expect(paused).toContain("yarnOga has paused online payments and payouts");
    expect(paused).toContain("Reviewing recent payments.");
  });

  it("is for owners only", async () => {
    const s = setup();
    const cookie = await login(s, STAFF, "manager");
    expect(await (await get(s, "/verify", cookie)).text()).toContain("Only the business owner");
  });
});

describe("first-time tour", () => {
  it("is off unless switched on", async () => {
    const s = setup();
    expect(await (await get(s, "/", await login(s, OWNER))).text()).not.toContain('id="tour"');
    expect(await (await get(s, "/help", await login(s, OWNER))).text()).not.toContain("Show me around");
  });

  it("shows on the dashboard only, with steps for what the person can see", async () => {
    const s = setup({}, { tour: true });
    const owner = await login(s, OWNER);
    const dash = await (await get(s, "/", owner)).text();
    expect(dash).toContain('id="tour"');
    expect(dash).toContain('"start":false');
    expect(dash).toContain('"href":"/home/settings"');
    expect(await (await get(s, "/orders", owner)).text()).not.toContain('id="tour"');
    expect(await (await get(s, "/help", owner)).text()).toContain('href="/home?tour=1"');
    expect(await (await get(s, "/?tour=1", owner)).text()).toContain('"start":true');

    const rider = await (await get(s, "/", await login(s, "2348044444444", "rider"))).text();
    expect(rider).toContain('"href":"/home/orders"');
    expect(rider).not.toContain('"href":"/home/inbox"');
    expect(rider).not.toContain('"href":"/home/settings"');
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

  describe("offline till", () => {
    function withTill() {
      const counter = memoryCounter();
      const offline: CounterSale[] = [];
      const keys = new Set<string>();
      counter.sellOffline = vi.fn(async (sale) => {
        if (sale.lines.some((l) => l.variantId === "99999999-9999-9999-9999-999999999999")) return { ok: false as const, reason: "unknown" as const };
        if (keys.has(sale.key)) return { ok: true as const, saleId: "dup", duplicate: true };
        keys.add(sale.key);
        offline.push({
          id: `66666666-6666-6666-6666-${String(offline.length + 1).padStart(12, "0")}`,
          at: sale.soldAt,
          soldBy: sale.userId,
          paidBy: sale.paidBy,
          totalKobo: sale.lines.reduce((t, l) => t + l.totalKobo, 0),
          voided: false,
          lines: sale.lines.map((l) => ({ name: l.name, quantity: l.quantity, totalKobo: l.totalKobo, unitCostKobo: null })),
          offline: {
            syncedAt: new Date(),
            short: [{ name: "Peak milk: Tin", by: 2 }],
            repriced: sale.lines.filter((l) => l.listPriceKobo !== null).map((l) => ({ name: l.name, chargedKobo: l.unitPriceKobo, listKobo: l.listPriceKobo! })),
          },
        });
        return { ok: true as const, saleId: "x", duplicate: false };
      });
      counter.sales = async () => offline;
      const s = setup({ counter, currency: "NGN" }, { offline: true });
      s.prices.all.push(milk());
      return { ...s, counter, offline };
    }
    const json = (body: unknown, cookie: string) => ({
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", Origin: `https://${HOST}`, Host: HOST, cookie },
    });

    it("keeps the till's price, notes a changed price list, and checks what the till sent", () => {
      const now = new Date("2026-11-04T12:00:00Z");
      const sale = { key: crypto.randomUUID(), paidBy: "cash", at: "2026-11-04T09:30:00Z", lines: [{ id: TIN, quantity: 2, unitPriceKobo: 48_000 }, { id: SACHET, quantity: 1, unitPriceKobo: 10_000 }] };
      const read = readTillSale(sale, [milk()], now);
      expect(read.ok && read.sale.lines).toEqual([
        { variantId: TIN, name: "Peak milk: Tin", quantity: 2, unitPriceKobo: 48_000, totalKobo: 96_000, listPriceKobo: 50_000 },
        { variantId: SACHET, name: "Peak milk: Sachet", quantity: 1, unitPriceKobo: 10_000, totalKobo: 10_000, listPriceKobo: null },
      ]);
      expect(read.ok && read.sale.soldAt.toISOString()).toBe("2026-11-04T09:30:00.000Z");
      // A fast clock doesn't put the sale in the future.
      const ahead = readTillSale({ ...sale, at: "2026-11-05T09:30:00Z" }, [milk()], now);
      expect(ahead.ok && ahead.sale.soldAt).toEqual(now);
      // Removed from the price list since: kept with the till's name.
      const gone = readTillSale({ ...sale, lines: [{ id: TIN, name: "Peak milk: Tin", quantity: 1, unitPriceKobo: 50_000 }] }, [], now);
      expect(gone.ok && gone.sale.lines[0]).toMatchObject({ name: "Peak milk: Tin", listPriceKobo: null });
      expect(readTillSale({ ...sale, lines: [{ id: TIN, quantity: 1.5, unitPriceKobo: 1 }] }, [milk()], now).ok).toBe(false);
      expect(readTillSale({ ...sale, lines: [{ id: TIN, quantity: 1, unitPriceKobo: -5 }] }, [milk()], now).ok).toBe(false);
      expect(readTillSale({ ...sale, lines: [sale.lines[0], sale.lines[0]] }, [milk()], now).ok).toBe(false);
      expect(readTillSale({ ...sale, paidBy: "card" }, [milk()], now).ok).toBe(false);
      expect(readTillSale({ ...sale, key: "1" }, [milk()], now).ok).toBe(false);
    });

    it("opens the till and its files without a login, so it works offline", async () => {
      const s = withTill();
      const page = await s.app.request("/till");
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('rel="manifest" href="/home/manifest.webmanifest"');
      expect(html).toContain("/home/sw.js");
      expect(html).not.toContain("Peak milk");
      const sw = await s.app.request("/sw.js");
      expect(sw.headers.get("content-type")).toContain("javascript");
      expect(await sw.text()).toContain('"/home/till"');
      expect(JSON.parse(await (await s.app.request("/manifest.webmanifest")).text())).toMatchObject({ start_url: "/home/till", display: "standalone" });
      expect((await s.app.request("/brand/app-512.png")).status).toBe(200);
      // The price list itself needs a login.
      expect((await s.app.request("/till/data")).headers.get("location")).toBe("/home/login");
    });

    it("gives the till the price list and records each sale once", async () => {
      const s = withTill();
      const cookie = await login(s, STAFF, "cashier");
      const data = (await (await get(s, "/till/data", cookie)).json()) as { businessId: string; userId: string; items: Array<{ id: string; tiers: number[][] }> };
      expect(data.businessId).toBe(BIZ);
      expect(data.items.find((i) => i.id === TIN)!.tiers).toEqual([[1, 50_000], [12, 45_000]]);

      const sale = { key: crypto.randomUUID(), businessId: BIZ, userId: data.userId, at: new Date().toISOString(), paidBy: "pos", lines: [{ id: TIN, name: "Peak milk: Tin", quantity: 1, unitPriceKobo: 48_000 }] };
      const other = { ...sale, key: crypto.randomUUID(), businessId: "77777777-7777-7777-7777-777777777777" };
      const unknown = { ...sale, key: crypto.randomUUID(), lines: [{ id: "99999999-9999-9999-9999-999999999999", quantity: 1, unitPriceKobo: 1 }] };
      const first = await s.app.request(`https://${HOST}/till/sync`, json({ sales: [sale, other, unknown] }, cookie));
      expect(((await first.json()) as { results: Array<{ status: string }> }).results.map((r) => r.status)).toEqual(["saved", "other_business", "refused"]);
      const again = await s.app.request(`https://${HOST}/till/sync`, json({ sales: [sale] }, cookie));
      expect(((await again.json()) as { results: Array<{ status: string }> }).results[0]!.status).toBe("duplicate");
      expect(s.offline).toHaveLength(1);
      expect(s.offline[0]).toMatchObject({ paidBy: "pos", totalKobo: 48_000, soldBy: data.userId });

      const owner = await login(s, OWNER);
      const counter = await (await get(s, "/counter", owner)).text();
      expect(counter).toContain('href="/home/till"');
      expect(counter).toContain("Open the till");
      expect(counter).not.toContain("Till (works offline)");
      // The rest of the menu sits under four headings, in the side menu and in the phone's "More".
      for (const head of ["Selling", "Money", "Marketing", "Setup"]) {
        expect(counter).toContain(`<p class="navhead">${head}</p>`);
        expect(counter).toContain(`<p class="sheethead">${head}</p>`);
      }
      expect(counter).toContain("offline till");
      expect(counter).toContain("sold 2 more than the stock showed");
      expect(counter).toContain("charged ₦480 each; the price list says ₦500");
    });

    it("refuses riders, and isn't there when the switch is off", async () => {
      const s = withTill();
      expect((await get(s, "/till/data", await login(s, "2348044444444", "rider"))).status).toBe(403);
      const off = withCounter();
      expect((await off.app.request("/till")).status).not.toBe(200);
      const offPage = await (await get(off, "/counter", await login(off, OWNER))).text();
      expect(offPage).not.toContain("/home/till");
    });
  });

  it("stays hidden when counter sales are off", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    expect(await (await get(s, "/", cookie)).text()).not.toContain("/home/counter");
    expect((await get(s, "/counter", cookie)).status).toBe(404);
    expect(await (await get(s, "/prices/new", cookie)).text()).not.toContain("_cost");
  });
});

describe("barcodes at the counter", () => {
  const TIN = "44444444-4444-4444-4444-000000000001";
  const milk = (barcode: string | null = "5000159484695"): ProductRecord => ({
    id: "22222222-2222-2222-2222-000000000001",
    name: "Peak milk",
    description: null,
    category: null,
    unit: null,
    leadTimeDays: null,
    active: true,
    photoPath: null,
    options: [{ id: TIN, name: "Tin", minQuantity: 1, stock: 5, barcode, tiers: [{ minQuantity: 1, unitPriceKobo: 50_000 }] }],
  });
  const counter: CounterStore = {
    sell: vi.fn(),
    void: vi.fn(),
    sales: async () => [],
    paidOrders: async () => [],
  };
  function withBarcodes(on = true) {
    const s = setup({ counter, barcodes: on });
    s.prices.all.push(milk());
    return s;
  }

  it("treats a UPC-A code and its EAN-13 form as the same barcode", () => {
    expect(barcodeKey("012345678905")).toBe(barcodeKey("0012345678905"));
    expect(barcodeKey(" abc-12 ")).toBe("ABC-12");
    expect(barcodeKey("0")).toBe("0");
  });

  it("reads a barcode on the product form, and refuses a bad or repeated one", () => {
    const form = { name: "Bournvita", o0_name: "Tin", o0_p0: "2500", o0_barcode: " 6156000 01234 5 " };
    expect(readProductForm(form).input.options[0]!.barcode).toBe("6156000012345");
    expect(readProductForm({ ...form, o0_barcode: "" }).input.options[0]!.barcode).toBeNull();
    expect("barcode" in readProductForm({ name: "Bournvita", o0_name: "Tin", o0_p0: "2500" }).input.options[0]!).toBe(false);
    expect(readProductForm({ ...form, o0_barcode: "<b>" }).problems[0]).toContain("isn't a barcode");
    expect(readProductForm({ ...form, o1_name: "Refill", o1_p0: "2000", o1_barcode: "06156000012345" }).problems).toEqual(["Two options have the same barcode."]);
    const taken = barcodesTaken([milk()], null, [{ name: "Tin", minQuantity: 1, stock: null, barcode: "05000159484695", tiers: [] }]);
    expect(taken).toEqual(["Barcode 05000159484695 is already on Peak milk: Tin. Each barcode can be on one option only."]);
    expect(barcodesTaken([milk()], milk().id, milk().options)).toEqual([]);
  });

  it("puts a Scan button and each option's barcode on the counter screen", async () => {
    const s = withBarcodes();
    const cookie = await login(s, OWNER);
    const screen = await (await get(s, "/counter", cookie)).text();
    expect(screen).toContain('data-barcode="5000159484695"');
    expect(screen).toContain('id="scan"');
    expect(screen).toContain("scanBarcodes");
    expect(await (await get(s, `/prices/${milk().id}`, cookie)).text()).toContain('name="o0_barcode" maxlength="60" autocomplete="off" value="5000159484695"');
  });

  it("won't save a barcode another product already has", async () => {
    const s = withBarcodes();
    const cookie = await login(s, OWNER);
    const res = await s.app.request(`https://${HOST}/prices/new`, post({ name: "Bournvita", o0_name: "Tin", o0_p0: "2500", o0_barcode: "5000159484695" }, cookie));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("already on Peak milk: Tin");
    expect(s.prices.all).toHaveLength(1);
  });

  it("stays off without the switch", async () => {
    const s = withBarcodes(false);
    const cookie = await login(s, OWNER);
    const screen = await (await get(s, "/counter", cookie)).text();
    expect(screen).not.toContain("data-barcode");
    expect(screen).not.toContain('id="scan"');
    expect(await (await get(s, "/prices/new", cookie)).text()).not.toContain("_barcode");
  });

  it("serves the scanner for phones without a built-in one, zipped", async () => {
    const s = setup();
    const res = await s.app.request(`https://${HOST}/assets/zxing.js`, { headers: { "accept-encoding": "gzip, br" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("cache-control")).toContain("max-age");
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


describe("About transaction fees", () => {
  const settings = async (payLinks: AppBusiness["payLinks"]) => {
    const s = setup({ payLinks, currency: "NGN" });
    return (await get(s, "/settings", await login(s, OWNER))).text();
  };

  it("shows yarnOga's fee before pay links are switched on", async () => {
    const html = await settings({ on: false, feeBasisPoints: async () => 250 });
    expect(html).toContain("yarnOga's fee is 2.5%, never more than ₦2,000 a payment");
    expect(html).not.toContain("shown here before");
  });

  it("works out yarnOga's share in the example once pay links are on", async () => {
    const html = await settings({ on: true, feeBasisPoints: async () => 250 });
    expect(html).toContain("Paystack keeps ₦250, yarnOga keeps ₦250");
    expect(html).toContain("₦9,500");
  });

  it("says so when the plan carries no yarnOga fee", async () => {
    const html = await settings({ on: true, feeBasisPoints: async () => 0 });
    expect(html).toContain("yarnOga takes no fee on your plan");
    expect(html).toContain("Paystack's fee comes out of the payment");
  });
});

describe("tax summary", () => {
  const at = (iso: string) => new Date(iso);
  const takings = [
    // 31 Oct 23:30 UTC is already 1 November in Lagos.
    { at: at("2026-10-31T23:30:00Z"), totalKobo: 10_750_000, kind: "order" as const },
    { at: at("2026-10-05T10:00:00Z"), totalKobo: 2_150_000, kind: "order" as const },
    { at: at("2026-10-06T10:00:00Z"), totalKobo: 2_150_000, kind: "counter" as const },
    { at: at("2025-12-20T10:00:00Z"), totalKobo: 1_500_000_000, kind: "order" as const },
  ];
  const withTax = (currency: "NGN" | "XOF" = "NGN") => setup({ currency, tax: { takings: vi.fn(async () => takings) } });

  it("adds up each Lagos month, with the VAT inside and 1%", () => {
    const rows = taxMonths(takings, ["2026-10", "2026-11"]);
    expect(rows[0]).toMatchObject({ month: "2026-10", ordersKobo: 2_150_000, orders: 1, counterKobo: 2_150_000, counter: 1, salesKobo: 4_300_000, vatKobo: 300_000, presumptiveKobo: 43_000 });
    expect(rows[1]).toMatchObject({ salesKobo: 10_750_000, vatKobo: 750_000, presumptiveKobo: 107_500 });
    expect(taxTotal(rows).salesKobo).toBe(15_050_000);
    expect(vatInside(10_750)).toBe(750);
    expect(yearMonths(2026, at("2026-11-03T12:00:00Z"))).toHaveLength(11);
    expect(yearMonths(2025, at("2026-11-03T12:00:00Z"))).toHaveLength(12);
    expect(taxCsv(rows).split("\r\n")[3]).toBe("Total,129000.00,21500.00,150500.00,10500.00,1505.00");
  });

  it("shows the owner the year, the last 12 months against the tax lines, and a CSV", async () => {
    const s = withTax();
    const cookie = await login(s, OWNER);
    const html = await (await get(s, "/tax?year=2026", cookie)).text();
    expect(html).toContain("Tax summary");
    expect(html).toContain("₦150,500");
    expect(html).toContain("not tax advice");
    // ₦15,150,500 in the last 12 months: over the ₦12 million line, under ₦50 million.
    expect(html).toContain("₦15,150,500");
    expect(html.match(/You&#39;re over|You're over/g)).toHaveLength(1);
    const csv = await get(s, "/tax/sales-2026.csv", cookie);
    expect(csv.headers.get("content-disposition")).toContain("sales-for-tax-2026.csv");
    expect(await csv.text()).toContain("2026-10,21500.00,21500.00,43000.00,3000.00,430.00");
  });

  it("is for owners, naira businesses, and only when switched on", async () => {
    const s = withTax();
    expect(await (await get(s, "/tax", await login(s, STAFF, "manager"))).text()).toContain("Only the business owner");
    expect(await (await get(withTax("XOF"), "/tax", await login(withTax("XOF"), OWNER))).text()).not.toContain("<table");
    const off = setup();
    const cookie = await login(off, OWNER);
    expect((await get(off, "/tax", cookie)).status).toBe(404);
    expect(await (await get(off, "/", cookie)).text()).not.toContain("/home/tax");
  });
});

describe("ads page", () => {
  const now = new Date();
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const lead = (contactId: string, firstAt: Date, freeUntil: Date | null = null) => ({
    numberId: "PNID",
    contactId,
    sourceType: "ad",
    sourceId: "1202",
    sourceUrl: "https://fb.me/abc",
    headline: "Order cakes on WhatsApp",
    firstAt,
    freeUntil,
  });
  const leads = [lead("c1", ago(30), new Date(now.getTime() + 3_600_000)), lead("c2", ago(24 * 10)), lead("c3", ago(2))];
  const orders = [
    { contactId: "c1", status: "paid", createdAt: ago(20) },
    { contactId: "c2", status: "quoted", createdAt: ago(24 * 9) },
    // Before c3 saw the ad, so it isn't the ad's.
    { contactId: "c3", status: "confirmed", createdAt: ago(5) },
  ];

  it("counts a quote or order for an ad only after the person came from it", () => {
    const [row] = withOrders(summariseAds(leads, now), orders);
    expect(row).toMatchObject({ leads: 3, leads7: 2, quoted: 2, ordered: 1, freeNow: 1 });
  });

  it("shows the owner each ad's leads and orders", async () => {
    const s = setup({ ads: { leads: vi.fn(async () => leads), orders: vi.fn(async () => orders) } });
    const cookie = await login(s, OWNER);
    const html = await (await get(s, "/ads", cookie)).text();
    expect(html).toContain("Order cakes on WhatsApp");
    expect(html).toContain("Ad ID 1202");
    expect(html).toContain("72 hours");
    expect(await (await get(s, "/", cookie)).text()).toContain("/home/ads");
    expect(await (await get(s, "/ads", await login(s, STAFF, "manager"))).text()).toContain("Only the business owner");
  });

  it("is hidden when switched off", async () => {
    const off = setup();
    const cookie = await login(off, OWNER);
    expect((await get(off, "/ads", cookie)).status).toBe(404);
    expect(await (await get(off, "/", cookie)).text()).not.toContain("/home/ads");
  });
});

describe("business flyers", () => {
  const tier = (unitPriceKobo: number, minQuantity = 1) => ({ minQuantity, unitPriceKobo });
  const option = (tiers: Array<{ minQuantity: number; unitPriceKobo: number }>, stock: number | null = null, minQuantity = 1) => ({ name: "Standard", minQuantity, stock, tiers });
  const product = (options: ReturnType<typeof option>[]) => ({ name: "Mug", description: null, category: null, unit: null, leadTimeDays: null, active: true, options });

  it("prices a product from the price list: exact for one price, lowest for several", () => {
    expect(flyerPrice(product([option([tier(300000)])]))).toEqual({ kobo: 300000, from: false });
    expect(flyerPrice(product([option([tier(300000), tier(250000, 50)])]))).toEqual({ kobo: 250000, from: true });
    expect(flyerPrice(product([option([tier(300000)]), option([tier(450000)])]))).toEqual({ kobo: 300000, from: true });
    // Sold out and unpriced options don't count.
    expect(flyerPrice(product([option([tier(100000)], 0), option([tier(450000)])]))).toEqual({ kobo: 450000, from: false });
    expect(flyerPrice(product([option([])]))).toBeNull();
  });

  it("writes the number the way customers dial it", () => {
    expect(flyerNumber("2347048971600")).toBe("0704 897 1600");
    expect(flyerNumber("254712345678")).toBe("+254 712345678");
  });

  it("makes a flyer from ticked products and shows it on every design", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    const id = await s.prices.save(null, product([option([tier(300000)])]));
    const page = await (await get(s, `/flyers?p=${id}`, cookie)).text();
    expect(page).toContain(`value="${id}" checked`);
    expect(page).toContain("₦3,000");

    const body = new FormData();
    body.set("headline", "Weekend offer");
    body.set("product", id);
    body.set("prices", "on");
    body.set("colour", "#e8541e");
    const made = await s.app.request(`https://${HOST}/flyers`, { method: "POST", body, headers: { Origin: `https://${HOST}`, Host: HOST, cookie } });
    expect(made.status).toBe(303);
    const at = made.headers.get("location")!;
    expect(at).toMatch(/^\/home\/flyers\/[0-9a-f]{24}$/);
    const path = at.replace("/home", "");
    const designs = await (await get(s, path, cookie)).text();
    for (const d of ["spotlight", "grid", "menu", "bold", "snapshots", "glass"]) expect(designs).toContain(`${at}/${d}.jpg?small=1`);
    const jpg = await get(s, `${path}/grid.jpg`, cookie);
    expect(jpg.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await jpg.arrayBuffer())[0]).toBe(0xff);
    expect(await (await get(s, `${path}/grid`, cookie)).text()).toContain("Download");
    expect(await (await get(s, `/flyers?from=${path.split("/")[2]}`, cookie)).text()).toContain('value="Weekend offer"');
    // Unknown flyers and designs.
    expect((await get(s, "/flyers/nope", cookie)).status).toBe(404);
    expect((await get(s, `${path}/nope.jpg`, cookie)).status).toBe(404);
  }, 20_000);

  it("asks for something to show, and keeps riders out", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    const body = new FormData();
    body.set("headline", "Weekend offer");
    const res = await s.app.request(`https://${HOST}/flyers`, { method: "POST", body, headers: { Origin: `https://${HOST}`, Host: HOST, cookie } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Tick a product or add a picture.");
    expect(await (await get(s, "/flyers", await login(s, STAFF, "rider"))).text()).toContain("Not for your role");
  });
});

describe("business flyers on a plan with a monthly number", () => {
  function limited(planLimit: number, packs = 0) {
    let onPlan = 0;
    let fromPacks = 0;
    const flyers: NonNullable<AppBusiness["flyers"]> = {
      status: async () => ({ planLimit, planLeft: Math.max(0, planLimit - onPlan), packLeft: packs - fromPacks }),
      async use() {
        if (packs - fromPacks > 0) return (fromPacks += 1), "pack";
        if (onPlan < planLimit) return (onPlan += 1), "plan";
        return null;
      },
      packs: async () => [{ code: "flyers-10", name: "10 flyers", flyers: 10, priceKobo: 100000 }],
      link: vi.fn(async () => "https://pay.example/pack"),
    };
    return flyers;
  }
  async function draft(s: ReturnType<typeof setup>, cookie: string) {
    const id = await s.prices.save(null, { name: "Mug", description: null, category: null, unit: null, leadTimeDays: null, active: true, options: [{ name: "Standard", minQuantity: 1, stock: null, tiers: [{ minQuantity: 1, unitPriceKobo: 300000 }] }] });
    const body = new FormData();
    body.set("headline", "Weekend offer");
    body.set("product", id);
    const made = await s.app.request(`https://${HOST}/flyers`, { method: "POST", body, headers: { Origin: `https://${HOST}`, Host: HOST, cookie } });
    return made.headers.get("location")!.replace("/home", "");
  }

  it("counts a flyer when it's opened, keeps it to the plan's designs, and offers a pack for the rest", async () => {
    const s = setup({ flyers: limited(1) });
    const cookie = await login(s, OWNER);
    const path = await draft(s, cookie);
    const designs = await (await get(s, path, cookie)).text();
    expect(designs).toContain("1 of 1 free flyers left this month");
    expect(designs).toContain("with a flyer pack or a paid plan");
    // Not counted yet: no full-size flyer.
    expect((await get(s, `${path}/grid.jpg`, cookie)).status).toBe(404);
    expect((await get(s, `${path}/grid.jpg?small=1`, cookie)).status).toBe(200);

    const locked = await (await get(s, `${path}/glass`, cookie)).text();
    expect(locked).toContain("The Glass design comes with a flyer pack or a paid plan.");
    expect(locked).toContain("Buy 10 flyers");
    expect(locked).toContain("₦1,000");

    expect(await (await get(s, `${path}/grid`, cookie)).text()).toContain("Download");
    expect((await get(s, `${path}/grid.jpg`, cookie)).status).toBe(200);
    expect((await get(s, `${path}/glass.jpg`, cookie)).status).toBe(404);
    // The same flyer in another plan design isn't counted again; a new one is, and the month's flyers are used up.
    expect(await (await get(s, `${path}/spotlight`, cookie)).text()).toContain("Download");
    expect(await (await get(s, `${await draft(s, cookie)}/grid`, cookie)).text()).toContain("You've made your 1 free flyers for this month");
  }, 20_000);

  it("opens every design with a pack, and sends the owner to pay for one", async () => {
    const flyers = limited(0, 1);
    const s = setup({ flyers });
    const cookie = await login(s, OWNER);
    const path = await draft(s, cookie);
    expect(await (await get(s, path, cookie)).text()).toContain("You have 1 pack flyer left");
    expect(await (await get(s, `${path}/glass`, cookie)).text()).toContain("Download");
    expect((await get(s, `${path}/bold.jpg`, cookie)).status).toBe(200);

    const buy = await s.app.request(`https://${HOST}/flyers/pack`, post({ pack: "flyers-10", back: path.split("/")[2]! }, cookie));
    expect(buy.headers.get("location")).toBe("https://pay.example/pack");
    expect(flyers.link).toHaveBeenCalledWith("flyers-10", OWNER);
    const staff = await login(s, STAFF, "manager");
    expect(await (await s.app.request(`https://${HOST}/flyers/pack`, post({ pack: "flyers-10" }, staff))).text()).toContain("Only the business owner");
  }, 20_000);
});

describe("sending a flyer to customers", () => {
  async function flyerPage(s: ReturnType<typeof setup>, cookie: string) {
    const id = await s.prices.save(null, { name: "Mug", description: null, category: null, unit: null, leadTimeDays: null, active: true, options: [{ name: "Standard", minQuantity: 1, stock: null, tiers: [{ minQuantity: 1, unitPriceKobo: 300000 }] }] });
    const body = new FormData();
    body.set("headline", "Weekend offer");
    body.set("product", id);
    const made = await s.app.request(`https://${HOST}/flyers`, { method: "POST", body, headers: { Origin: `https://${HOST}`, Host: HOST, cookie } });
    return `${made.headers.get("location")!.replace("/home", "")}/grid`;
  }

  const noPacks = { packs: async () => [], link: async () => null };

  it("sells message packs when the messages can't reach everyone, at the pack's price", async () => {
    const link = vi.fn(async (code: string) => (code === "messages-100" ? "https://pay.example/m" : null));
    const packs = { packs: async () => [{ code: "messages-100", name: "100 messages", messages: 100, priceKobo: 1500000 }], link };
    // A shop with no messages and nothing to buy doesn't see the box.
    const none = setup({ sendFlyer: { reach: async () => ({ optedIn: 30, left: 0, monthly: 0 }), packs: noPacks, send: vi.fn() } });
    const noneCookie = await login(none, OWNER);
    expect(await (await get(none, await flyerPage(none, noneCookie), noneCookie)).text()).not.toContain("Send to your customers");

    const short = setup({ sendFlyer: { reach: async () => ({ optedIn: 30, left: 0, monthly: 0 }), packs, send: vi.fn() } });
    const shortCookie = await login(short, OWNER);
    const shortPage = await flyerPage(short, shortCookie);
    const html = await (await get(short, shortPage, shortCookie)).text();
    expect(html).toContain("you have no messages left");
    expect(html).toContain("<b>100 messages</b> for ₦15,000");
    expect(html).not.toContain("Send to 0");
    const bought = await short.app.request(`https://${HOST}/flyers/messages`, post({ pack: "messages-100", back: shortPage.replace("/flyers/", "") }, shortCookie));
    expect(bought.headers.get("location")).toBe("https://pay.example/m");
    expect(link).toHaveBeenCalledWith("messages-100", OWNER);
    const staff = await login(short, STAFF, "manager");
    expect(await (await short.app.request(`https://${HOST}/flyers/messages`, post({ pack: "messages-100" }, staff))).text()).toContain("Only the business owner");
  }, 20_000);

  it("sends the flyer and the owner's message to everyone opted in, owners only", async () => {
    const send = vi.fn(async () => ({ outcome: "queued" as const, id: 7, recipients: 12 }));
    const s = setup({ sendFlyer: { reach: async () => ({ optedIn: 12, left: 40, monthly: 100 }), packs: noPacks, send } });
    const cookie = await login(s, OWNER);
    const page = await flyerPage(s, cookie);
    const html = await (await get(s, page, cookie)).text();
    expect(html).toContain("Send to 12 customers");
    expect(html).toContain("You have 40 messages left");
    expect(html).not.toContain("Buy ");
    const res = await s.app.request(`https://${HOST}${page}/send`, post({ message: "Weekend offer on mugs" }, cookie));
    expect(res.headers.get("location")).toBe(`/home${page}?msg=flyer_sent`);
    const [message, jpeg, waId] = send.mock.calls[0] as unknown as [string, Uint8Array, string];
    expect(message).toBe("Weekend offer on mugs");
    expect(jpeg[0]).toBe(0xff);
    expect(waId).toBe(OWNER);

    const staff = await login(s, STAFF, "manager");
    expect(await (await get(s, page, staff)).text()).not.toContain("Send to your customers");
    expect(await (await s.app.request(`https://${HOST}${page}/send`, post({ message: "x" }, staff))).text()).toContain("Only the business owner");
    expect(send).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("explains how customers opt in when nobody has, and hides it when broadcasts are off", async () => {
    const s = setup({ sendFlyer: { reach: async () => ({ optedIn: 0, left: 40, monthly: 100 }), packs: noPacks, send: vi.fn() } });
    const cookie = await login(s, OWNER);
    expect(await (await get(s, await flyerPage(s, cookie), cookie)).text()).toContain("send <b>JOIN</b>");
    const off = setup();
    const offCookie = await login(off, OWNER);
    expect(await (await get(off, await flyerPage(off, offCookie), offCookie)).text()).not.toContain("Send to your customers");
  }, 20_000);
});

describe("customer files in the owner app", () => {
  async function withFiles() {
    const files = memoryCustomerFiles();
    const photo = await files.save({ contactId: "c1", orderId: order.id, waMessageId: "wamid.photo", kind: "order", mimeType: "image/jpeg", fileName: null, caption: "this style", data: new Uint8Array([1, 2]) });
    const cdr = await files.save({ contactId: "c1", orderId: order.id, waMessageId: "wamid.cdr", kind: "order", mimeType: "application/octet-stream", fileName: "logo final.cdr", caption: null, data: new Uint8Array([3]) });
    const svg = await files.save({ contactId: "c1", orderId: order.id, waMessageId: "wamid.svg", kind: "order", mimeType: "image/svg+xml", fileName: "x.svg", caption: null, data: new Uint8Array([4]) });
    for (const f of [photo, cdr, svg]) f.id = f.id.replace(/^f/, "44444444-4444-4444-4444-00000000000");
    const s = setup({ customerFiles: files });
    s.board.orders = async () => [{ ...order, notes: "chest 42, waist 36", files: [{ id: cdr.id, label: "logo final.cdr (1 KB)" }] }];
    return { s, photo, cdr, svg };
  }

  it("shows the customer's details and files on the order board", async () => {
    const { s, cdr } = await withFiles();
    const board = await (await get(s, "/orders", await login(s, OWNER))).text();
    expect(board).toContain("📝 chest 42, waist 36");
    expect(board).toContain(`href="/home/files/${cdr.id}?download=1">📎 logo final.cdr (1 KB)`);
  });

  it("opens pictures in the browser and downloads every other file, SVG included", async () => {
    const { s, photo, cdr, svg } = await withFiles();
    const cookie = await login(s, STAFF, "cashier");
    const pic = await get(s, `/files/${photo.id}`, cookie);
    expect(pic.headers.get("content-type")).toBe("image/jpeg");
    expect(pic.headers.get("content-disposition")).toContain("inline");
    const file = await get(s, `/files/${cdr.id}`, cookie);
    expect(file.headers.get("content-type")).toBe("application/octet-stream");
    expect(file.headers.get("content-disposition")).toBe('attachment; filename="logo final.cdr"');
    expect((await get(s, `/files/${svg.id}`, cookie)).headers.get("content-type")).toBe("application/octet-stream");
    expect((await get(s, "/files/44444444-4444-4444-4444-999999999999", cookie)).status).toBe(404);
  });

  it("lets the owner say what the bot asks for before confirming a product", async () => {
    const { s } = await withFiles();
    const cookie = await login(s, OWNER);
    expect(await (await get(s, "/prices/new", cookie)).text()).toContain("Ask the customer for");
    await s.app.request(`https://${HOST}/prices/new`, post({ name: "Agbada", askFor: "Measurements: chest, waist, length", o0_name: "Sewing", o0_p0: "25000" }, cookie));
    expect(s.prices.all[0]!.askFor).toBe("Measurements: chest, waist, length");
    // Without customer files the box isn't there.
    const off = setup();
    expect(await (await get(off, "/prices/new", await login(off, OWNER))).text()).not.toContain("Ask the customer for");
  });
});

describe("adding many product photos", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const product = (n: number, name: string, extra: Partial<ProductRecord> = {}): ProductRecord => ({
    id: `22222222-2222-2222-2222-${String(n).padStart(12, "0")}`,
    name,
    description: null,
    category: "Drinks",
    unit: null,
    leadTimeDays: null,
    active: true,
    photoPath: null,
    morePhotos: [],
    options: [{ name: "Standard", minQuantity: 1, stock: null, tiers: [{ minQuantity: 1, unitPriceKobo: 50_000 }] }],
    ...extra,
  });
  function withPhotos(photos = true) {
    const savePhoto = vi.fn(async () => {});
    const s = setup({ barcodes: true, ...(photos ? { photos: { savePhoto, photo: async () => null } } : {}) });
    s.prices.all.push(
      product(1, "Peak milk", { options: [{ name: "Tin", minQuantity: 1, stock: null, barcode: "05000159484695", tiers: [] }] }),
      product(2, "Coke 50cl", { photoPath: "businesses/x/products/2" }),
      product(3, "Ankara </script> gown", { category: "Styles" }),
    );
    return { ...s, savePhoto };
  }
  const sendPhoto = (s: ReturnType<typeof setup>, id: string, bytes: Uint8Array, cookie: string) => {
    const body = new FormData();
    body.append("photo", new File([bytes], "photo.jpg", { type: "image/jpeg" }));
    return s.app.request(`https://${HOST}/prices/${id}/photo`, { method: "POST", body, headers: { Origin: `https://${HOST}`, Host: HOST, cookie } });
  };

  it("matches a photo to a product by barcode, name or the longest name inside it", () => {
    const match = new Function(`${BARCODE_KEY_JS}\n${MATCH_JS}\nreturn matchPhoto;`)() as (file: string, products: Array<{ name: string; codes: string[] }>) => { name: string } | null;
    const list = [
      { name: "Peak milk", codes: [barcodeKey("05000159484695")] },
      { name: "Peak milk tin", codes: [] },
      { name: "Coke 50cl", codes: [] },
      { name: "Fanta 50cl", codes: [] },
      { name: "Gown", codes: [] },
    ];
    expect(match("5000159484695.jpg", list)?.name).toBe("Peak milk");
    expect(match("peak-milk_TIN (2).JPG", list)?.name).toBe("Peak milk tin");
    expect(match("coke 50cl 1.png", list)?.name).toBe("Coke 50cl");
    expect(match("IMG fresh Fanta 50cl front.jpeg", list)?.name).toBe("Fanta 50cl");
    expect(match("ankara gown.jpg", list)?.name).toBe("Gown");
    expect(match("IMG_2041.jpg", list)).toBeNull();
    expect(match("peak milk tin and coke 50cl.jpg", list)?.name).toBe("Peak milk tin");
    expect(match("pepsi 50cl fanta 50cl.jpg", [{ name: "Pepsi 50cl", codes: [] }, list[3]!])).toBeNull();
  });

  it("opens the photo page from the price list, with each product for the walk", async () => {
    const s = withPhotos();
    const cookie = await login(s, OWNER);
    expect(await (await get(s, "/prices", cookie)).text()).toContain("Add photos (2 missing)");
    const page = await (await get(s, "/prices/photos", cookie)).text();
    expect(page).toContain("1 of 3 products have a photo.");
    expect(page).toContain('"codes":["5000159484695"]');
    expect(page).toContain("Ankara \\u003c/script> gown");
    expect(page).toContain('id="w-scan"');
    expect(page).toContain('capture="environment"');
  });

  it("saves one product's photo, and refuses anything that isn't a photo", async () => {
    const s = withPhotos();
    const cookie = await login(s, OWNER);
    const id = s.prices.all[0]!.id;
    const ok = await sendPhoto(s, id, JPEG, cookie);
    expect(ok.status).toBe(200);
    expect(s.savePhoto).toHaveBeenCalledWith(id, JPEG, "image/jpeg");
    const bad = await sendPhoto(s, id, new Uint8Array([1, 2, 3]), cookie);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "The photo must be a JPEG or PNG picture." });
    expect((await sendPhoto(s, "22222222-2222-2222-2222-000000000099", JPEG, cookie)).status).toBe(404);
    expect(s.savePhoto).toHaveBeenCalledTimes(1);
  });

  it("is for owners and managers, and only with product photos on", async () => {
    const s = withPhotos();
    const cashier = await login(s, STAFF, "cashier");
    expect(await (await get(s, "/prices/photos", cashier)).text()).toContain("Not for your role");
    expect((await sendPhoto(s, s.prices.all[0]!.id, JPEG, cashier)).status).not.toBe(200);
    expect(s.savePhoto).not.toHaveBeenCalled();
    const off = withPhotos(false);
    const owner = await login(off, OWNER);
    expect(await (await get(off, "/prices", owner)).text()).not.toContain("Add photos");
    expect(await (await get(off, "/prices/photos", owner)).text()).toContain("Send <b>plan</b>");
  });
});

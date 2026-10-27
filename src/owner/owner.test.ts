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
import type { AppUser, BusinessData, ExportRow, PriceStore, ProductRecord, UserStore } from "./store.js";
import type { AppBusiness, OwnerAppDeps } from "./types.js";
import { copyOwnerNotices, withAlertCopies, withAppLogin } from "./whatsapp.js";
import { memoryVerifications } from "../compliance/memory.js";

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
    async addStaff(businessId, waId, name) {
      return add(businessId, waId, "staff", name);
    },
    async removeStaff(businessId, userId) {
      const u = users.get(userId);
      if (u && u.businessId === businessId && u.role === "staff") Object.assign(u, { active: false, sessionEpoch: u.sessionEpoch + 1 });
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
      const p = { ...input, id: `22222222-2222-2222-2222-${String(all.length + 1).padStart(12, "0")}`, photoPath: null };
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
async function login(s: ReturnType<typeof setup>, waId: string, role: "owner" | "staff" = "owner") {
  const user = role === "owner" ? await s.users.store.ensureOwner(BIZ, waId) : await s.users.store.addStaff(BIZ, waId, "Bola");
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
    expect(res.headers.get("location")).toBe("/app/login");
    expect(await (await s.app.request("/login")).text()).toContain("Send <b>app</b>");
  });

  it("logs in once from a WhatsApp link, which then stops working", async () => {
    const s = setup();
    const owner = await s.users.store.ensureOwner(BIZ, OWNER);
    await s.users.store.saveToken(owner.id, hashToken("abc"), new Date(Date.now() + 60_000));
    // Opening the link only shows a button, so link previews can't use it up.
    expect(await (await s.app.request("/l/abc")).text()).toContain("Show my sales");
    const first = await s.app.request(`https://${HOST}/l/abc`, post({}));
    expect(first.headers.get("location")).toBe("/app");
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
    const cookie = await login(s, STAFF, "staff");
    expect(await (await get(s, "/orders", cookie)).text()).toContain("KP-1002");
    expect(await (await get(s, "/settings", cookie)).text()).toContain("Only the business owner");
    expect(await (await get(s, "/export", cookie)).text()).toContain("Only the business owner");
  });

  it("marks an order paid from the board", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    const res = await s.app.request(`https://${HOST}/orders/paid`, post({ order: order.id, number: "1002" }, cookie));
    expect(res.headers.get("location")).toBe("/app/orders?msg=paid");
    expect(s.markPaid).toHaveBeenCalledWith(1002);
  });

  it("adds a product with price breaks, in kobo", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    const res = await s.app.request(
      `https://${HOST}/prices/new`,
      post({ name: "Flyers", description: "Glossy", o0_name: "A5", o0_min: "50", o0_f0: "", o0_p0: "₦1,500", o0_f1: "500", o0_p1: "1200.50" }, cookie),
    );
    expect(res.headers.get("location")).toBe("/app/prices?msg=saved");
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

describe("verify your business", () => {
  it("takes details and real documents, sends once everything is there, then locks", async () => {
    const s = setup();
    const cookie = await login(s, OWNER);
    expect(await (await get(s, "/verify", cookie)).text()).toContain("Let's verify your business");
    await s.app.request(`https://${HOST}/verify/details`, post({ type: "business_name", name: "Kahn Prints", rc: "BN 3456789", address: "12 Allen Ave", director: "Ada Okafor" }, cookie));
    expect(s.kyb.rows.get(BIZ)).toMatchObject({ entityType: "business_name", rcNumber: "3456789" });

    // Sending too early is refused.
    expect((await s.app.request(`https://${HOST}/verify/submit`, post({}, cookie))).headers.get("location")).toBe("/app/verify?msg=bad");

    const upload = (kind: string, bytes: Uint8Array, name: string) => {
      const fd = new FormData();
      fd.set("kind", kind);
      fd.set("file", new File([bytes], name));
      return s.app.request(`https://${HOST}/verify/doc`, { method: "POST", body: fd, headers: { Origin: `https://${HOST}`, Host: HOST, cookie } });
    };
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect((await upload("certificate", new TextEncoder().encode("<script>"), "x.pdf")).headers.get("location")).toBe("/app/verify?msg=bad");
    for (const kind of ["certificate", "id", "address"]) await upload(kind, pdf, `${kind}.pdf`);
    expect(s.kyb.docs).toHaveLength(3);

    expect((await s.app.request(`https://${HOST}/verify/submit`, post({}, cookie))).headers.get("location")).toBe("/app/verify?msg=sent_review");
    expect(s.onSubmitted).toHaveBeenCalledWith(BIZ, "Kahn");
    // Once sent, details can't be changed.
    await s.app.request(`https://${HOST}/verify/details`, post({ type: "company", name: "Other" }, cookie));
    expect(s.kyb.rows.get(BIZ)!.registeredName).toBe("Kahn Prints");
  });

  it("is for owners only", async () => {
    const s = setup();
    const cookie = await login(s, STAFF, "staff");
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
    users.add(BIZ, STAFF, "staff", "Bola");
    const wrapped = withAppLogin(bot, { users: users.store, publicUrl: "https://app.example.com", businessFor: async () => ({ id: BIZ, ownerWaId: OWNER }) });
    expect((await wrapped.handle(msg(OWNER, "app"), ctx))!.text).toContain("https://app.example.com/app/l/");
    expect((await wrapped.handle(msg(STAFF, "login"), ctx))!.text).toContain("/app/l/");
    expect((await wrapped.handle(msg("2348000000000", "app"), ctx))!.text).toBe("bot");
  });

  it("copies owner alerts to the extra alert numbers", async () => {
    const wrapped = withAlertCopies(bot, { ownerWaId: OWNER, numbers: async () => ["2348044444444", OWNER] });
    const reply = await wrapped.handle(msg("2348000000000", "yes"), ctx);
    expect(reply!.notify!.map((n) => n.to)).toEqual([OWNER, "2348044444444"]);
    expect(copyOwnerNotices([{ to: "x", text: "receipt" }], OWNER, ["y"])).toHaveLength(1);
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPaystackTransfers, type PaystackTransfers } from "../core/payments/paystack.js";
import { createPaymentRoutes } from "../core/payments/routes.js";
import { hashToken } from "./auth.js";
import { createOwnerApp } from "./index.js";
import { createPayouts, type Payout, type PayoutStatus, type PayoutStore, type Recipient } from "./payouts.js";
import type { Role } from "./roles.js";
import type { AppUser, UserStore } from "./store.js";
import type { AppBusiness } from "./types.js";

const BIZ = "11111111-1111-1111-1111-111111111111";
const RIDER = "44444444-4444-4444-4444-444444444444";
const DELIVERY = "55555555-5555-5555-5555-555555555555";
const quiet = { info() {}, warn() {}, error() {} };

/** Behaves like payout_start / payout_finish in migration 0066. */
function memoryPayouts(start = 0) {
  const ledger: Array<{ kind: string; amount: number; ref?: string; payoutId?: string }> = start ? [{ kind: "topup", amount: start, ref: "seed" }] : [];
  const payouts = new Map<string, Payout & { recipientCode: string }>();
  const recipients: Recipient[] = [];
  let n = 0;
  const live = new Set<PayoutStatus>(["sending", "pending", "otp", "success"]);
  const store: PayoutStore = {
    balance: async () => ledger.reduce((s, l) => s + l.amount, 0),
    recipients: async () => recipients,
    async saveRecipient(r) {
      const i = recipients.findIndex((x) => (r.riderId && x.riderId === r.riderId) || (r.userId && x.userId === r.userId));
      const row = { ...r, id: i >= 0 ? recipients[i]!.id : `rcp-${recipients.length + 1}` };
      if (i >= 0) recipients[i] = row;
      else recipients.push(row);
    },
    transferFee: async (amount) => (amount <= 500000 ? 1000 : amount <= 5000000 ? 2500 : 5000),
    async draft(p) {
      n += 1;
      const id = `66666666-6666-6666-6666-${String(n).padStart(12, "0")}`;
      payouts.set(id, { ...p, id, status: "draft", failure: null, createdAt: new Date(), sentAt: null });
      return id;
    },
    get: async (id) => payouts.get(id) ?? null,
    recent: async () => [...payouts.values()].filter((p) => p.status !== "draft"),
    unpaidDeliveries: async () =>
      [...payouts.values()].some((p) => p.deliveryId === DELIVERY && live.has(p.status))
        ? []
        : [{ id: DELIVERY, orderRef: "KP-1001", riderId: RIDER, riderName: "Musa", feeKobo: 250000, deliveredAt: new Date() }],
    async start(id) {
      const p = payouts.get(id);
      if (!p || p.status !== "draft") return "gone";
      if ((await store.balance()) < p.amountKobo + p.feeKobo) return "low";
      if (p.deliveryId && [...payouts.values()].some((o) => o.deliveryId === p.deliveryId && live.has(o.status))) return "paid";
      Object.assign(p, { status: "sending", sentAt: new Date() });
      ledger.push({ kind: "payout", amount: -(p.amountKobo + p.feeKobo), payoutId: id });
      return "ok";
    },
    async finish(id, status, _code, failure) {
      const p = payouts.get(id);
      if (!p || p.status === status) return false;
      const from = status === "reversed" ? ["sending", "pending", "otp", "success"] : ["sending", "pending", "otp"];
      if (!from.includes(p.status)) return false;
      Object.assign(p, { status, failure });
      if ((status === "failed" || status === "reversed") && !ledger.some((l) => l.kind === "refund" && l.payoutId === id)) {
        ledger.push({ kind: "refund", amount: p.amountKobo + p.feeKobo, payoutId: id });
      }
      return true;
    },
    async credit(ref, amount) {
      if (ledger.some((l) => l.ref === ref)) return false;
      ledger.push({ kind: "topup", amount, ref });
      return true;
    },
  };
  return { store, payouts, ledger, recipients };
}

function fakeTransfers(answer: () => Promise<{ status: string }>) {
  return {
    recipient: vi.fn(async () => "RCP_test"),
    send: vi.fn(async () => ({ transferCode: "TRF_1", failure: null, ...(await answer()) })),
    verify: vi.fn(async (): Promise<{ status: string; transferCode: string | null; failure: string | null } | null> => ({ status: "success", transferCode: "TRF_1", failure: null })),
  } satisfies PaystackTransfers;
}

const draftFor = (amountKobo: number, deliveryId: string | null = null) => ({
  recipientId: "rcp-1",
  recipientCode: "RCP_test",
  payeeName: "Musa",
  payeeWaId: "2348055555555",
  accountLabel: "GTBank ••••6789 (MUSA BELLO)",
  amountKobo,
  reason: "Delivery KP-1001",
  deliveryId,
  createdBy: null,
});

describe("payouts", () => {
  it("takes the amount and fee off the balance once, and tells the payee", async () => {
    const m = memoryPayouts(1000000);
    const tellPayee = vi.fn(async () => {});
    const payouts = createPayouts({ store: m.store, transfers: fakeTransfers(async () => ({ status: "success" })), tellPayee, businessName: "Kahn", log: quiet });
    const id = await payouts.draft(draftFor(250000));
    expect(await m.store.balance()).toBe(1000000); // a draft moves nothing
    expect(await payouts.send(id)).toBe("sent");
    expect(await m.store.balance()).toBe(1000000 - 250000 - 1000);
    expect(await payouts.send(id)).toBe("gone"); // a second tap
    expect(await m.store.balance()).toBe(749000);
    expect(tellPayee).toHaveBeenCalledWith("2348055555555", expect.stringContaining("₦2,500"));
  });

  it("refuses when the balance is too low and sends nothing", async () => {
    const m = memoryPayouts(100000);
    const transfers = fakeTransfers(async () => ({ status: "success" }));
    const payouts = createPayouts({ store: m.store, transfers, businessName: "Kahn", log: quiet });
    expect(await payouts.send(await payouts.draft(draftFor(100000)))).toBe("low"); // ₦1,000 + ₦10 fee
    expect(transfers.send).not.toHaveBeenCalled();
  });

  it("puts the money back when Paystack says no, only once", async () => {
    const m = memoryPayouts(1000000);
    const transfers = fakeTransfers(async () => ({ status: "failed" }));
    const payouts = createPayouts({ store: m.store, transfers, businessName: "Kahn", log: quiet });
    const id = await payouts.draft(draftFor(250000));
    expect(await payouts.send(id)).toBe("failed");
    expect(await m.store.balance()).toBe(1000000);
    transfers.verify.mockResolvedValueOnce({ status: "reversed", transferCode: null, failure: null });
    await payouts.check(id);
    expect(await m.store.balance()).toBe(1000000);
  });

  it("keeps the money held when Paystack's answer is unclear, until it's checked", async () => {
    const m = memoryPayouts(1000000);
    let now = new Date();
    const transfers = fakeTransfers(async () => {
      throw new Error("timeout");
    });
    const payouts = createPayouts({ store: m.store, transfers, businessName: "Kahn", now: () => now, log: quiet });
    const id = await payouts.draft(draftFor(250000));
    expect(await payouts.send(id)).toBe("unsure");
    expect(await m.store.balance()).toBe(749000);
    // Paystack has never heard of it: not refunded straight away, in case it's still on its way...
    transfers.verify.mockResolvedValue(null);
    expect(await payouts.check(id)).toBe("sending");
    expect(await m.store.balance()).toBe(749000);
    // ...but after 10 minutes it is.
    now = new Date(now.getTime() + 11 * 60_000);
    expect(await payouts.check(id)).toBe("failed");
    expect(await m.store.balance()).toBe(1000000);
  });

  it("can't pay the same delivery twice", async () => {
    const m = memoryPayouts(2000000);
    const payouts = createPayouts({ store: m.store, transfers: fakeTransfers(async () => ({ status: "pending" })), businessName: "Kahn", log: quiet });
    const first = await payouts.draft(draftFor(250000, DELIVERY));
    const second = await payouts.draft(draftFor(250000, DELIVERY));
    expect(await payouts.send(first)).toBe("pending");
    expect(await payouts.send(second)).toBe("paid");
  });
});

describe("Paystack transfers client", () => {
  const client = (status: number, body: unknown) => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
    return { fetchImpl, t: createPaystackTransfers({ secretKey: "sk_test_x" }, fetchImpl as unknown as typeof fetch) };
  };

  it("sends from the balance with our reference", async () => {
    const { fetchImpl, t } = client(200, { status: true, data: { status: "success", transfer_code: "TRF_9" } });
    expect(await t.send({ reference: "yarnoga-pay-x", amountKobo: 250000, recipientCode: "RCP_1", reason: "Delivery KP-1001" })).toEqual({ status: "success", transferCode: "TRF_9", failure: null });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ source: "balance", amount: 250000, recipient: "RCP_1", reference: "yarnoga-pay-x", currency: "NGN" });
  });

  it("reads a 4xx as nothing sent, and a 5xx as unknown", async () => {
    expect((await client(400, { status: false, message: "Your balance is not enough" }).t.send({ reference: "r", amountKobo: 100, recipientCode: "R", reason: "x" })).status).toBe("failed");
    await expect(client(502, {}).t.send({ reference: "r", amountKobo: 100, recipientCode: "R", reason: "x" })).rejects.toThrow();
    expect(await client(404, { status: false }).t.verify("r")).toBeNull();
  });
});

describe("Paystack transfer webhooks", () => {
  const sign = (body: string) => createHmac("sha512", "sk_test_x").update(body).digest("hex");
  it("checks our transfers and ignores other references", async () => {
    const confirm = vi.fn(async () => "success");
    const app = createPaymentRoutes({ payments: { confirm: vi.fn(), createLink: vi.fn() } as never, secretKey: "sk_test_x", transfers: { confirm }, log: quiet });
    const ref = "yarnoga-pay-12345678-1234-1234-1234-123456789012";
    const send = (body: string) => app.request("/webhooks/paystack", { method: "POST", body, headers: { "x-paystack-signature": sign(body) } });
    expect((await send(JSON.stringify({ event: "transfer.success", data: { reference: ref } }))).status).toBe(200);
    expect(confirm).toHaveBeenCalledWith(ref);
    await send(JSON.stringify({ event: "transfer.success", data: { reference: "someone-else" } }));
    expect(confirm).toHaveBeenCalledTimes(1);
    const unsigned = JSON.stringify({ event: "transfer.failed", data: { reference: ref } });
    expect((await app.request("/webhooks/paystack", { method: "POST", body: unsigned })).status).toBe(401);
  });
});

describe("Pay people page", () => {
  const HOST = "app.example.com";
  function setup() {
    const users = new Map<string, AppUser>();
    let n = 0;
    const add = (waId: string, role: Role, name: string | null) => {
      n += 1;
      const u: AppUser = { id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, businessId: BIZ, waId, name, role, passwordHash: null, sessionEpoch: 0, active: true, lastLoginAt: null };
      users.set(u.id, u);
      return u;
    };
    const tokens = new Map<string, string>();
    const store = {
      get: async (id: string) => users.get(id) ?? null,
      byWaId: async (waId: string) => [...users.values()].filter((u) => u.waId === waId),
      team: async () => [...users.values()],
      touchLogin: async () => {},
      useToken: async (hash: string) => tokens.get(hash) ?? null,
    } as unknown as UserStore;
    const m = memoryPayouts(1000000);
    const transfers = fakeTransfers(async () => ({ status: "success" }));
    const service = createPayouts({ store: m.store, transfers, businessName: "Kahn", log: quiet });
    const recipient = vi.fn(async () => "RCP_new");
    const biz = {
      id: BIZ,
      name: "Kahn",
      orderPrefix: "KP",
      currency: "NGN",
      delivery: { riders: async () => [{ id: RIDER, name: "Musa", waId: "2348055555555" }] },
      payouts: { service, topUpLink: async () => "https://checkout.paystack.com/abc", recipient },
      data: {},
    } as unknown as AppBusiness;
    const app = createOwnerApp({
      secret: "s",
      publicUrl: `https://${HOST}`,
      users: store,
      business: async () => biz,
      support: { email: "support@example.com" },
      banks: { banks: async () => [{ name: "GTBank", code: "058" }], resolve: async () => "MUSA BELLO" },
      log: quiet,
    });
    const login = async (role: Role) => {
      const u = add(`23480${role.length}0000000`, role, role === "owner" ? null : "Bola");
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
    return { m, transfers, recipient, login, post, get };
  }

  it("lets the owner check a rider's bank, then pay a delivery after confirming", async () => {
    const s = setup();
    const owner = await s.login("owner");
    const page = await (await s.get("/pay", owner)).text();
    expect(page).toContain("₦10,000");
    expect(page).toContain("KP-1001");
    expect((await s.post("/pay/bank", { who: `rider:${RIDER}`, bank: "058|GTBank", account: "0123456789" }, owner)).headers.get("location")).toBe("/home/pay?msg=bank_saved");
    expect(s.m.recipients[0]).toMatchObject({ riderId: RIDER, accountName: "MUSA BELLO", recipientCode: "RCP_new" });

    const draft = await s.post("/pay/new", { who: `rider:${RIDER}`, delivery: DELIVERY, amount: "2,000" }, owner);
    const confirmAt = draft.headers.get("location")!;
    expect(confirmAt).toMatch(/^\/home\/pay\/confirm\//);
    expect(s.transfers.send).not.toHaveBeenCalled();
    const confirm = await (await s.get(confirmAt.replace("/home", ""), owner)).text();
    expect(confirm).toContain("Yes, send ₦2,000 to Musa");
    expect(confirm).toContain("MUSA BELLO");
    const id = confirmAt.split("/").pop()!;
    expect((await s.post(`/pay/${id}/send`, {}, owner)).headers.get("location")).toBe("/home/pay?msg=pay_sent");
    expect((await s.post(`/pay/${id}/send`, {}, owner)).headers.get("location")).toBe("/home/pay?msg=pay_gone");
    expect(s.transfers.send).toHaveBeenCalledTimes(1);
    expect(await s.m.store.balance()).toBe(1000000 - 200000 - 1000);
  });

  it("lets a manager pay but not change bank details, and keeps cashiers out", async () => {
    const s = setup();
    await s.m.store.saveRecipient({ riderId: RIDER, userId: null, bankCode: "058", bankName: "GTBank", accountNumber: "0123456789", accountName: "MUSA BELLO", recipientCode: "RCP_1" });
    const manager = await s.login("manager");
    expect((await s.get("/pay", manager)).status).toBe(200);
    expect((await s.post("/pay/bank", { who: `rider:${RIDER}`, bank: "058|GTBank", account: "9999999999" }, manager)).headers.get("location")).toBe("/home/pay?msg=owner_only");
    expect(s.recipient).not.toHaveBeenCalled();
    expect((await s.post("/pay/new", { who: `rider:${RIDER}`, amount: "5000", reason: "Wages" }, manager)).headers.get("location")).toMatch(/confirm/);
    const cashier = await s.login("cashier");
    expect(await (await s.get("/pay", cashier)).text()).toContain("doesn't include this page");
    expect((await s.post("/pay/new", { who: `rider:${RIDER}`, amount: "5000", reason: "x" }, cashier)).headers.get("location")).toBe("/home?msg=not_allowed");
  });
});

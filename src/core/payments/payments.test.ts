import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPayments, type PaidHandler } from "./payments.js";
import { createPaystackClient, isValidPaystackSignature, type PaystackTransaction } from "./paystack.js";
import { createPaymentRoutes } from "./routes.js";
import type { Payment, PaymentStore } from "./store.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const SECRET = "sk_test_secret";

function memoryStore() {
  const rows: Payment[] = [];
  const store: PaymentStore = {
    async create(p) {
      const row: Payment = { ...p, id: `p${rows.length + 1}`, status: "pending" };
      rows.push(row);
      return { ...row };
    },
    async byReference(reference) {
      const row = rows.find((r) => r.reference === reference);
      return row ? { ...row } : null;
    },
    async markPaid(id) {
      const row = rows.find((r) => r.id === id && r.status === "pending");
      if (!row) return false;
      row.status = "paid";
      return true;
    },
    async markPending(id) {
      rows.find((r) => r.id === id)!.status = "pending";
    },
    async createWithPromo(p, code, months) {
      if (code !== "DAYONES") return { result: "unknown", code, maxUses: null };
      const amountOffKobo = ((p.amountKobo / months) * 50) / 100;
      rows.push({ ...p, amountKobo: p.amountKobo - amountOffKobo, promoCode: code, id: `p${rows.length + 1}`, status: "pending" });
      return { result: "applied", code, percentOff: 50, amountOffKobo };
    },
  };
  return { store, rows };
}

function setup(tx: Partial<PaystackTransaction> = {}, onPaid?: PaidHandler) {
  const { store, rows } = memoryStore();
  const paystack = {
    initialize: vi.fn(async (p: { reference: string }) => `https://checkout.paystack.com/${p.reference}`),
    verify: vi.fn(async (reference: string) => ({
      id: "4099",
      reference,
      status: "success",
      amountKobo: rows.find((r) => r.reference === reference)?.amountKobo ?? 0,
      currency: "NGN",
      ...tx,
    })),
  };
  const handler = vi.fn(onPaid ?? (async (p: Payment) => [{ to: p.waId, text: "Thanks" }]));
  const send = vi.fn(async () => {});
  const payments = createPayments({
    paystack,
    store,
    callbackUrl: "https://bot.example.com/payments/done",
    customerEmail: "payments@example.com",
    onPaid: { flyer: handler },
    send,
    log: silent,
  });
  return { payments, paystack, rows, handler, send };
}

const request = { product: "flyer", waId: "2348011111111", amountKobo: 450000, purpose: { plan: "standard" }, title: "Standard" };
const sign = (body: string) => createHmac("sha512", SECRET).update(body).digest("hex");

describe("payments", () => {
  it("saves a pending payment and returns Paystack's checkout link", async () => {
    const { payments, paystack, rows } = setup();
    const link = await payments.createLink(request);
    expect(rows[0]).toMatchObject({ product: "flyer", amountKobo: 450000, status: "pending" });
    expect(rows[0]!.reference).toMatch(/^yarnoga-flyer-[0-9a-f-]{36}$/);
    expect(paystack.initialize).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 450000, email: "payments@example.com" }));
    expect(link).toEqual({ url: `https://checkout.paystack.com/${rows[0]!.reference}`, amountKobo: 450000, promo: null });
  });

  it("charges the discounted amount with a promo code, and makes no link when the code can't be used", async () => {
    const { payments, paystack, rows } = setup();
    const link = await payments.createLink({ ...request, amountKobo: 1350000, promo: { code: "DAYONES", months: 3 } });
    expect(link).toMatchObject({ amountKobo: 1125000, promo: { code: "DAYONES", amountOffKobo: 225000 } });
    expect(rows[0]).toMatchObject({ amountKobo: 1125000, promoCode: "DAYONES" });
    expect(paystack.initialize).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 1125000 }));

    expect(await payments.createLink({ ...request, promo: { code: "NOPE", months: 1 } })).toEqual({
      url: null,
      refused: { result: "unknown", code: "NOPE", maxUses: null },
    });
    expect(rows).toHaveLength(1);
    expect(paystack.initialize).toHaveBeenCalledTimes(1);
  });

  it("refuses fractions of a kobo and products with nothing to do once paid", async () => {
    const { payments } = setup();
    await expect(payments.createLink({ ...request, amountKobo: 4500.5 })).rejects.toThrow("kobo");
    await expect(payments.createLink({ ...request, product: "leads" })).rejects.toThrow("no onPaid");
  });

  it("runs the product's onPaid once, however many times Paystack tells us", async () => {
    const { payments, rows, handler, send } = setup();
    await payments.createLink(request);
    const ref = rows[0]!.reference;
    expect(await payments.confirm(ref)).toBe("paid");
    expect(await payments.confirm(ref)).toBe("already-paid");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("flyer", "2348011111111", "Thanks");
  });

  it("doesn't activate anything paid short, failed or unknown", async () => {
    const short = setup({ amountKobo: 100 });
    await short.payments.createLink(request);
    expect(await short.payments.confirm(short.rows[0]!.reference)).toBe("not-paid");

    const failed = setup({ status: "abandoned" });
    await failed.payments.createLink(request);
    expect(await failed.payments.confirm(failed.rows[0]!.reference)).toBe("not-paid");
    expect(failed.handler).not.toHaveBeenCalled();

    expect(await failed.payments.confirm("yarnoga-flyer-someone-else")).toBe("unknown");
    expect(failed.paystack.verify).toHaveBeenCalledTimes(1);
  });

  it("puts the payment back to pending when the product fails, so a retry works", async () => {
    let attempts = 0;
    const { payments, rows } = setup({}, async () => {
      if (++attempts === 1) throw new Error("database down");
      return [];
    });
    await payments.createLink(request);
    await expect(payments.confirm(rows[0]!.reference)).rejects.toThrow("database down");
    expect(rows[0]!.status).toBe("pending");
    expect(await payments.confirm(rows[0]!.reference)).toBe("paid");
  });
});

describe("paystack", () => {
  it("checks the webhook signature against the raw body", () => {
    const body = '{"event":"charge.success"}';
    expect(isValidPaystackSignature(body, sign(body), SECRET)).toBe(true);
    expect(isValidPaystackSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(isValidPaystackSignature(body, sign(body), "sk_test_other")).toBe(false);
    expect(isValidPaystackSignature(body, undefined, SECRET)).toBe(false);
    expect(isValidPaystackSignature(body, "zz", SECRET)).toBe(false);
  });

  it("sends kobo as is and reads the checkout link", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } }),
    );
    const client = createPaystackClient({ secretKey: SECRET }, fetchImpl as unknown as typeof fetch);
    const link = await client.initialize({
      reference: "yarnoga-flyer-1",
      amountKobo: 450000,
      email: "payments@example.com",
      callbackUrl: "https://bot.example.com/payments/done",
      description: "Standard",
      waId: "2348011111111",
    });
    expect(link).toBe("https://checkout.paystack.com/abc");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: 450000, currency: "NGN", reference: "yarnoga-flyer-1" });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("reports Paystack's own error message", async () => {
    const fetchImpl = async () => Response.json({ status: false, message: "Invalid key" }, { status: 401 });
    const client = createPaystackClient({ secretKey: SECRET }, fetchImpl as unknown as typeof fetch);
    await expect(client.verify("yarnoga-flyer-1")).rejects.toThrow("Invalid key");
  });
});

describe("payment routes", () => {
  function routes() {
    const confirm = vi.fn(async () => "paid" as const);
    const app = createPaymentRoutes({ payments: { confirm, createLink: vi.fn() }, secretKey: SECRET, log: silent });
    return { app, confirm };
  }
  const post = (app: ReturnType<typeof routes>["app"], body: string, signature?: string) =>
    app.request("/webhooks/paystack", {
      method: "POST",
      body,
      headers: signature ? { "x-paystack-signature": signature } : {},
    });

  it("rejects webhooks without a valid signature before doing anything", async () => {
    const { app, confirm } = routes();
    const body = JSON.stringify({ event: "charge.success", data: { reference: "yarnoga-flyer-1" } });
    expect((await post(app, body)).status).toBe(401);
    expect((await post(app, body, sign("other"))).status).toBe(401);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("confirms charge.success and ignores other events", async () => {
    const { app, confirm } = routes();
    const body = JSON.stringify({ event: "charge.success", data: { reference: "yarnoga-flyer-1" } });
    expect((await post(app, body, sign(body))).status).toBe(200);
    expect(confirm).toHaveBeenCalledWith("yarnoga-flyer-1");
    const transfer = JSON.stringify({ event: "transfer.success", data: { reference: "x" } });
    expect((await post(app, transfer, sign(transfer))).status).toBe(200);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("asks Paystack to retry when confirming fails", async () => {
    const { app, confirm } = routes();
    confirm.mockRejectedValueOnce(new Error("down"));
    const body = JSON.stringify({ event: "charge.success", data: { reference: "yarnoga-flyer-1" } });
    expect((await post(app, body, sign(body))).status).toBe(500);
  });

  it("checks the payment on the return page, only for our own references", async () => {
    const { app, confirm } = routes();
    const ref = "yarnoga-flyer-0b7c1c9e-3f43-4a4e-9a7a-6b1f0f6f2f11";
    expect(await (await app.request(`/payments/done?reference=${ref}`)).text()).toContain("Payment received");
    expect(await (await app.request("/payments/done?reference=<script>")).text()).toContain("wasn't completed");
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

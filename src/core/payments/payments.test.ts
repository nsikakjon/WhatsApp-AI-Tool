import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPayments, type PaidHandler } from "./payments.js";
import { createFlutterwaveClient, isValidFlutterwaveHash } from "./flutterwave.js";
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

function setup(tx: Partial<PaystackTransaction> = {}, onPaid?: PaidHandler, receiptEmailFor?: (waId: string) => Promise<string | undefined>) {
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
    receiptEmailFor,
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

  it("puts the payer's own email on the payment when they gave us one for receipts", async () => {
    const emails: Record<string, string> = { "2348011111111": "ada@example.com" };
    const { payments, paystack } = setup({}, undefined, async (waId) => emails[waId]);
    await payments.createLink(request);
    await payments.createLink({ ...request, waId: "2348022222222" });
    expect(paystack.initialize.mock.calls.map(([p]) => (p as { email: string }).email)).toEqual(["ada@example.com", "payments@example.com"]);
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
    expect(send).toHaveBeenCalledWith("flyer", { to: "2348011111111", text: "Thanks" });
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
    expect(JSON.parse(String(init.body))).not.toHaveProperty("subaccount");
  });

  it("splits a store's payment to its subaccount, which pays Paystack's fee", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } }));
    const client = createPaystackClient({ secretKey: SECRET }, fetchImpl as unknown as typeof fetch);
    await client.initialize({
      reference: "yarnoga-quote-1",
      amountKobo: 13200000,
      email: "payments@example.com",
      callbackUrl: "https://bot.example.com/payments/done",
      description: "Order DEMO-1010",
      waId: "2348011111111",
      subaccount: "ACCT_abc123",
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: 13200000, subaccount: "ACCT_abc123", bearer: "subaccount" });
  });

  it("keeps yarnOga's fee on the main account when a split payment carries one", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc" } }));
    const client = createPaystackClient({ secretKey: SECRET }, fetchImpl as unknown as typeof fetch);
    const checkout = {
      reference: "yarnoga-quote-2",
      amountKobo: 1_000_000,
      email: "payments@example.com",
      callbackUrl: "https://bot.example.com/payments/done",
      description: "Order DEMO-1011",
      waId: "2348011111111",
      transactionChargeKobo: 25_000,
    };
    await client.initialize({ ...checkout, subaccount: "ACCT_abc123" });
    await client.initialize(checkout);
    const body = (i: number) => JSON.parse(String((fetchImpl.mock.calls[i] as unknown as [string, RequestInit])[1].body));
    expect(body(0)).toMatchObject({ subaccount: "ACCT_abc123", bearer: "subaccount", transaction_charge: 25_000 });
    expect(body(1)).not.toHaveProperty("transaction_charge");
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

describe("plans paid in other currencies", () => {
  it("charges US dollars through Paystack and won't activate a naira payment for them", async () => {
    const { payments, paystack, rows } = setup({ currency: "USD" });
    await payments.createLink({ ...request, amountKobo: 350, currency: "USD" });
    expect(rows[0]).toMatchObject({ currency: "USD", provider: "paystack" });
    expect(paystack.initialize).toHaveBeenCalledWith(expect.objectContaining({ amountKobo: 350, currency: "USD" }));
    expect(await payments.confirm(rows[0]!.reference)).toBe("paid");
    const naira = setup();
    await naira.payments.createLink({ ...request, amountKobo: 350, currency: "USD" });
    expect(await naira.payments.confirm(naira.rows[0]!.reference)).toBe("not-paid");
  });

  it("sends cedis and shillings to Flutterwave with Mobile Money or M-Pesa first, pesewas and all", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "success", data: { link: "https://checkout.flutterwave.com/pay/x" } }));
    const client = createFlutterwaveClient({ secretKey: "FLWSECK_TEST-abc", secretHash: "flw-secret-hash-1234567890" }, fetch as unknown as typeof globalThis.fetch);
    const base = { reference: "r", email: "e", callbackUrl: "c", description: "d", waId: "1" };
    await client.initialize({ ...base, amountMinor: 6_250, currency: "GHS" });
    await client.initialize({ ...base, amountMinor: 85_000, currency: "KES" });
    const sent = fetch.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(sent[0]).toMatchObject({ amount: 62.5, currency: "GHS", payment_options: "mobilemoneyghana,card" });
    expect(sent[1]).toMatchObject({ amount: 850, currency: "KES", payment_options: "mpesa,card" });
  });
});

describe("Flutterwave (CFA francs)", () => {
  const HASH = "flw-secret-hash-1234567890";

  function cfaSetup(tx: Partial<{ status: string; amountMinor: number; currency: string }> = {}) {
    const { store, rows } = memoryStore();
    const flutterwave = {
      initialize: vi.fn(async (p: { reference: string }) => `https://checkout.flutterwave.com/pay/${p.reference}`),
      verify: vi.fn(async (reference: string) => ({
        id: "88001",
        reference,
        status: "success",
        amountMinor: rows.find((r) => r.reference === reference)?.amountKobo ?? 0,
        currency: "XOF",
        ...tx,
      })),
    };
    const handler = vi.fn(async (p: Payment) => [{ to: p.waId, text: "Merci" }]);
    const payments = createPayments({
      flutterwave,
      store,
      callbackUrl: "https://bot.example.com/payments/done",
      customerEmail: "payments@example.com",
      onPaid: { quote: handler },
      send: vi.fn(async () => {}),
      log: silent,
    });
    return { payments, flutterwave, rows, handler };
  }
  const cfa = { product: "quote", waId: "2250712345678", amountKobo: 5_000_000, currency: "XOF" as const, purpose: { kind: "order" }, title: "Chez Awa CA-1001" };

  it("makes CFA links on Flutterwave and confirms them once, checking currency and amount", async () => {
    const { payments, flutterwave, rows, handler } = cfaSetup();
    const link = await payments.createLink({ ...cfa, subaccount: "RS_ABC", platformFeeKobo: 80_000 });
    expect(link.url).toContain("checkout.flutterwave.com");
    expect(rows[0]).toMatchObject({ currency: "XOF", provider: "flutterwave" });
    expect(flutterwave.initialize).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 5_000_000, currency: "XOF", subaccount: "RS_ABC", platformFeeMinor: 80_000 }));
    expect(await payments.confirm(rows[0]!.reference)).toBe("paid");
    expect(await payments.confirm(rows[0]!.reference)).toBe("already-paid");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("won't activate a payment in the wrong currency or for less", async () => {
    const short = cfaSetup({ amountMinor: 100 });
    await short.payments.createLink(cfa);
    expect(await short.payments.confirm(short.rows[0]!.reference)).toBe("not-paid");
    const naira = cfaSetup({ currency: "NGN" });
    await naira.payments.createLink(cfa);
    expect(await naira.payments.confirm(naira.rows[0]!.reference)).toBe("not-paid");
  });

  it("needs Flutterwave set up for CFA and Paystack for naira", async () => {
    const { payments } = cfaSetup();
    await expect(payments.createLink({ ...cfa, currency: undefined })).rejects.toThrow("Paystack");
  });

  it("rejects webhooks without the secret hash, and confirms the rest with Flutterwave", async () => {
    const { payments, rows, handler } = cfaSetup();
    await payments.createLink(cfa);
    const app = createPaymentRoutes({ payments, flutterwaveHash: HASH, log: silent });
    const body = JSON.stringify({ event: "charge.completed", data: { tx_ref: rows[0]!.reference, status: "successful" } });
    expect((await app.request("/webhooks/flutterwave", { method: "POST", body, headers: { "verif-hash": "wrong" } })).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect((await app.request("/webhooks/flutterwave", { method: "POST", body, headers: { "verif-hash": HASH } })).status).toBe(200);
    expect((await app.request("/webhooks/flutterwave", { method: "POST", body, headers: { "verif-hash": HASH } })).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    const page = await (await app.request(`/payments/done?status=successful&tx_ref=${rows[0]!.reference}&transaction_id=88001`)).text();
    expect(page).toContain("Paiement reçu");
  });

  it("sends Flutterwave whole francs and reads them back as hundredths", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("verify_by_reference")
        ? Response.json({ status: "success", data: { id: 88001, tx_ref: "yarnoga-quote-x", status: "successful", amount: 50000, currency: "XOF" } })
        : Response.json({ status: "success", data: { link: "https://checkout.flutterwave.com/pay/x" } }),
    );
    const client = createFlutterwaveClient({ secretKey: "FLWSECK_TEST-abc", secretHash: HASH }, fetch as unknown as typeof globalThis.fetch);
    await client.initialize({ reference: "yarnoga-quote-x", amountMinor: 5_000_000, currency: "XOF", email: "p@example.com", callbackUrl: "https://x/done", description: "Order", waId: "2250712345678", subaccount: "RS_ABC", platformFeeMinor: 80_000 });
    const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toMatchObject({ amount: 50000, currency: "XOF", payment_options: "mobilemoneyfranco,card", subaccounts: [{ id: "RS_ABC", transaction_charge_type: "flat", transaction_charge: 800 }] });
    expect(await client.verify("yarnoga-quote-x")).toMatchObject({ status: "success", amountMinor: 5_000_000, currency: "XOF" });
    await expect(client.initialize({ reference: "r", amountMinor: 150, currency: "XOF", email: "e", callbackUrl: "c", description: "d", waId: "1" })).rejects.toThrow("whole francs");
    expect(isValidFlutterwaveHash(HASH, HASH)).toBe(true);
    expect(isValidFlutterwaveHash(undefined, HASH)).toBe(false);
  });
});

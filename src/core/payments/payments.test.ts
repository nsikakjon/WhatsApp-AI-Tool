import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createFlutterwaveClient, isValidWebhookHash, koboToNaira, nairaToKobo, type FlutterwaveTransaction } from "./flutterwave.js";
import { createPayments, type PaidHandler } from "./payments.js";
import type { Payment, PaymentStore } from "./store.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };

function memoryStore() {
  const rows: Array<Payment & { providerTxId: string | null }> = [];
  const store: PaymentStore = {
    async create(p) {
      const row = { ...p, id: `p${rows.length + 1}`, status: "pending" as const, providerTxId: null };
      rows.push(row);
      return row;
    },
    async byRef(txRef) {
      return rows.find((r) => r.txRef === txRef) ?? null;
    },
    async markPaid(id, providerTxId) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "pending" || rows.some((r) => r.providerTxId === providerTxId)) return false;
      row.status = "paid";
      row.providerTxId = providerTxId;
      return true;
    },
    async markPending(id) {
      const row = rows.find((r) => r.id === id)!;
      row.status = "pending";
      row.providerTxId = null;
    },
  };
  return { rows, store };
}

function setup(handler: PaidHandler = async (p) => [{ to: p.waId, text: "Thanks!" }]) {
  const mem = memoryStore();
  const transactions = new Map<string, FlutterwaveTransaction>();
  const flutterwave = {
    createLink: vi.fn(async (p: { txRef: string }) => `https://checkout.flutterwave.com/pay/${p.txRef}`),
    verify: vi.fn(async (id: string) => {
      const tx = transactions.get(id);
      if (!tx) throw new Error("no such transaction");
      return tx;
    }),
  };
  const sent: Array<{ product: string; to: string; text: string }> = [];
  const onPaid = vi.fn(handler);
  const payments = createPayments({
    flutterwave,
    store: mem.store,
    redirectUrl: "https://duro.example/payments/done",
    customerEmail: "owner@example.com",
    onPaid: { flyer: onPaid },
    send: async (product, to, text) => void sent.push({ product, to, text }),
    log: silent,
  });
  /** Pretends someone paid `kobo` on Flutterwave for our latest link. */
  const pay = (id: string, kobo?: number, status = "successful") => {
    const row = mem.rows.at(-1)!;
    transactions.set(id, { id, txRef: row.txRef, status, amountKobo: kobo ?? row.amountKobo, currency: "NGN" });
  };
  return { ...mem, payments, flutterwave, onPaid, sent, pay };
}

const request = { product: "flyer", waId: "2348000000002", amountKobo: 300000, purpose: { plan: "standard" }, title: "Standard" };

describe("payments", () => {
  it("saves a pending payment and returns a Flutterwave link for the exact amount", async () => {
    const { payments, rows, flutterwave } = setup();
    const link = await payments.createLink(request);
    expect(rows).toMatchObject([{ product: "flyer", amountKobo: 300000, status: "pending", purpose: { plan: "standard" } }]);
    expect(link).toBe(`https://checkout.flutterwave.com/pay/${rows[0]!.txRef}`);
    expect(flutterwave.createLink).toHaveBeenCalledWith(
      expect.objectContaining({ amountKobo: 300000, customer: expect.objectContaining({ email: "owner@example.com", phone: "2348000000002" }) }),
    );
  });

  it("refuses money amounts that aren't whole kobo", async () => {
    const { payments } = setup();
    await expect(payments.createLink({ ...request, amountKobo: 3000.5 })).rejects.toThrow("kobo");
    await expect(payments.createLink({ ...request, amountKobo: 0 })).rejects.toThrow();
  });

  it("activates a paid payment exactly once, however many times it's confirmed", async () => {
    const { payments, pay, onPaid, sent } = setup();
    await payments.createLink(request);
    pay("111");
    expect(await payments.confirm("111")).toBe("paid");
    expect(await payments.confirm("111")).toBe("already-paid");
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ product: "flyer", to: "2348000000002", text: "Thanks!" }]);
  });

  it("does nothing for failed, short or unknown payments", async () => {
    const { payments, pay, onPaid } = setup();
    await payments.createLink(request);
    pay("1", undefined, "failed");
    expect(await payments.confirm("1")).toBe("not-paid");
    pay("2", 100);
    expect(await payments.confirm("2")).toBe("not-paid");
    await expect(payments.confirm("3")).rejects.toThrow();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("puts the payment back to pending if the product couldn't act on it, so a retry works", async () => {
    let fail = true;
    const { payments, pay, rows } = setup(async () => {
      if (fail) throw new Error("database down");
      return [];
    });
    await payments.createLink(request);
    pay("5");
    await expect(payments.confirm("5")).rejects.toThrow("database down");
    expect(rows[0]!.status).toBe("pending");
    fail = false;
    expect(await payments.confirm("5")).toBe("paid");
  });
});

describe("Flutterwave routes", () => {
  const whatsappDeps = {
    verifyToken: "v",
    appSecret: "s",
    store: {} as never,
    whatsapp: {} as never,
    route: () => ({ name: "x", handle: async () => null }),
    log: silent,
  };

  function app() {
    const t = setup();
    return { ...t, app: createApp(whatsappDeps, { payments: t.payments, webhookHash: "secret-hash", log: silent }) };
  }

  const webhook = (hash: string | undefined, id: number) =>
    new Request("http://x/webhooks/flutterwave", {
      method: "POST",
      headers: hash ? { "verif-hash": hash } : {},
      body: JSON.stringify({ event: "charge.completed", data: { id, status: "successful" } }),
    });

  it("rejects webhooks without the secret hash before doing anything", async () => {
    const { app: a, flutterwave } = app();
    expect((await a.request(webhook(undefined, 1))).status).toBe(401);
    expect((await a.request(webhook("wrong", 1))).status).toBe(401);
    expect(flutterwave.verify).not.toHaveBeenCalled();
  });

  it("confirms a payment from a genuine webhook, and ignores the retry", async () => {
    const { app: a, payments, pay, onPaid } = app();
    await payments.createLink(request);
    pay("42");
    expect((await a.request(webhook("secret-hash", 42))).status).toBe(200);
    expect((await a.request(webhook("secret-hash", 42))).status).toBe(200);
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it("asks Flutterwave to retry when checking fails", async () => {
    const { app: a } = app();
    expect((await a.request(webhook("secret-hash", 999))).status).toBe(500);
  });

  it("shows a thank-you page after paying, and switches the plan on if the webhook hasn't", async () => {
    const { app: a, payments, pay, onPaid } = app();
    await payments.createLink(request);
    pay("77");
    const res = await a.request("http://x/payments/done?status=successful&tx_ref=r&transaction_id=77");
    expect(await res.text()).toContain("Payment received");
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(await (await a.request("http://x/payments/done?status=cancelled")).text()).toContain("wasn't completed");
  });
});

describe("Flutterwave client", () => {
  it("converts kobo to naira without losing anything", () => {
    expect(koboToNaira(300000)).toBe(3000);
    expect(koboToNaira(300050)).toBe(3000.5);
    expect(nairaToKobo(3000.5)).toBe(300050);
    expect(nairaToKobo(19.99)).toBe(1999);
  });

  it("checks the webhook hash", () => {
    expect(isValidWebhookHash("abc", "abc")).toBe(true);
    expect(isValidWebhookHash("abd", "abc")).toBe(false);
    expect(isValidWebhookHash(undefined, "abc")).toBe(false);
  });

  it("makes a payment link and verifies a transaction", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const data = String(url).endsWith("/payments")
        ? { link: "https://checkout.flutterwave.com/v3/hosted/pay/abc" }
        : { id: 9, tx_ref: "duro-flyer-1", status: "successful", amount: 3000, currency: "NGN" };
      return new Response(JSON.stringify({ status: "success", data }));
    });
    const client = createFlutterwaveClient({ secretKey: "FLWSECK_TEST-x" }, fake as typeof fetch);
    const link = await client.createLink({
      txRef: "duro-flyer-1",
      amountKobo: 300000,
      redirectUrl: "https://duro.example/payments/done",
      customer: { email: "a@b.c", phone: "234" },
      title: "Standard",
    });
    expect(link).toContain("checkout.flutterwave.com");
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ tx_ref: "duro-flyer-1", amount: 3000, currency: "NGN" });
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer FLWSECK_TEST-x");
    expect(await client.verify("9")).toEqual({ id: "9", txRef: "duro-flyer-1", status: "successful", amountKobo: 300000, currency: "NGN" });
    await expect(client.verify("9/../../x")).rejects.toThrow();
  });
});

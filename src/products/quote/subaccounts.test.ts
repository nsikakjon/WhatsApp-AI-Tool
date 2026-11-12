import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createPaystackBanks } from "../../core/payments/paystack.js";
import { createSubaccounts } from "./subaccounts.js";

type Row = Record<string, unknown>;

/** Just enough of Supabase for subaccounts.ts: select/update with eq and is, read by maybeSingle. */
function fakeDb(tables: Record<string, Row[]>) {
  const db = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      const q = {
        select: () => q,
        update: (row: Row) => ((patch = row), q),
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), q),
        is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
        maybeSingle: async () => ({ data: tables[table]!.find((r) => filters.every((f) => f(r))) ?? null, error: null }),
        then(done: (r: { error: null }) => void) {
          for (const r of tables[table]!.filter((r) => filters.every((f) => f(r)))) Object.assign(r, patch);
          done({ error: null });
        },
      };
      return q;
    },
  };
  return db as unknown as SupabaseClient;
}

describe("Paystack subaccounts", () => {
  it("makes one from the invoice bank account, saves it, and reuses it", async () => {
    const tables = {
      quote_businesses: [{ id: "b1", name: "KahnPrints", paystack_subaccount: null } as Row],
      quote_bank_accounts: [{ business_id: "b1", is_primary: true, bank_code: "057", account_number: "0123456789" }],
    };
    const made: unknown[] = [];
    const subaccounts = createSubaccounts(fakeDb(tables), {
      createSubaccount: async (p) => (made.push(p), "ACCT_new"),
    });
    expect(await subaccounts.get("b1")).toBe("ACCT_new");
    expect(await subaccounts.get("b1")).toBe("ACCT_new");
    expect(made).toEqual([{ businessName: "KahnPrints", bankCode: "057", accountNumber: "0123456789" }]);
    expect(tables.quote_businesses[0]!.paystack_subaccount).toBe("ACCT_new");

    // A code Paystack refused is dropped, so the next link makes a fresh one.
    expect(await subaccounts.forget("b1")).toBe(true);
    expect(tables.quote_businesses[0]!.paystack_subaccount).toBeNull();
  });

  it("has nothing to make one from without an invoice bank account Paystack knows", async () => {
    const tables = {
      quote_businesses: [{ id: "b1", name: "Ada's", paystack_subaccount: null } as Row],
      quote_bank_accounts: [{ business_id: "b1", is_primary: true, bank_code: null, account_number: "0123456789" }],
    };
    const subaccounts = createSubaccounts(fakeDb(tables), {
      createSubaccount: async () => {
        throw new Error("shouldn't be called");
      },
    });
    expect(await subaccounts.get("b1")).toBeNull();
    expect(await subaccounts.forget("b1")).toBe(false);
  });

  it("asks Paystack for a 0% subaccount and returns its code", async () => {
    let sent: { url: string; body: unknown } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ status: true, data: { subaccount_code: "ACCT_abc" } }));
    }) as unknown as typeof fetch;
    const code = await createPaystackBanks({ secretKey: "sk_test_x" }, fetchImpl).createSubaccount({ businessName: "KahnPrints", bankCode: "057", accountNumber: "0123456789" });
    expect(code).toBe("ACCT_abc");
    expect(sent).toEqual({
      url: "https://api.paystack.co/subaccount",
      body: { business_name: "KahnPrints", settlement_bank: "057", account_number: "0123456789", percentage_charge: 0 },
    });
  });
});

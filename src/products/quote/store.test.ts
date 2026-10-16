import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseCatalog, createSupabaseOrders } from "./store.js";

/**
 * A stand-in for the Supabase client that records each query's steps
 * (table, filters, inserted rows) and answers with `result`.
 */
function recordingDb(result: { data: unknown; error: null }) {
  const calls: Array<Array<[string, ...unknown[]]>> = [];
  const db = {
    from(table: string) {
      const steps: Array<[string, ...unknown[]]> = [["from", table]];
      calls.push(steps);
      const query: any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
            return (...args: unknown[]) => {
              steps.push([prop, ...args]);
              return prop === "single" || prop === "maybeSingle" ? Promise.resolve(result) : query;
            };
          },
        },
      );
      return query;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const filters = (steps: Array<[string, ...unknown[]]>) => steps.filter((s) => s[0] === "eq");

describe("Supabase quote stores", () => {
  it("without a business, queries exactly as before (no business filter)", async () => {
    const { db, calls } = recordingDb({ data: [], error: null });
    await createSupabaseCatalog(db).activeVariants();
    await createSupabaseOrders(db).setStatus("o1", "confirmed");
    for (const steps of calls) expect(JSON.stringify(steps)).not.toContain("business_id");
  });

  it("with a business, only reads that business's price list", async () => {
    const { db, calls } = recordingDb({ data: [], error: null });
    await createSupabaseCatalog(db, "b2").activeVariants();
    expect(filters(calls[0]!)).toContainEqual(["eq", "quote_products.business_id", "b2"]);
  });

  it("with a business, stamps new quotes with it and keeps every order lookup inside it", async () => {
    const { db, calls } = recordingDb({ data: null, error: null });
    const orders = createSupabaseOrders(db, "b2");
    await orders.latestOpenQuote("c1");
    await orders.findOrder(1042);
    await orders.markPaid("o1").catch(() => undefined);
    await orders.setStatus("o1", "cancelled").catch(() => undefined);
    for (const steps of calls) expect(filters(steps)).toContainEqual(["eq", "business_id", "b2"]);

    const insert = recordingDb({ data: { id: "o9", order_number: 1009 }, error: null });
    await createSupabaseOrders(insert.db, "b2")
      .createQuote("c1", [], 0)
      .catch(() => undefined);
    expect(insert.calls[0]).toContainEqual(["insert", { contact_id: "c1", total_kobo: 0, business_id: "b2" }]);
  });
});

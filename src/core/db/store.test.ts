import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseStore } from "./store.js";

// A stand-in for Supabase whose messages table may not have business_number_id yet.
function fakeDb(hasNumberColumn: boolean) {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    from: () => ({
      async insert(row: Record<string, unknown>) {
        if (!hasNumberColumn && "business_number_id" in row) {
          return { error: { code: "PGRST204", message: "Could not find the 'business_number_id' column of 'messages'" } };
        }
        rows.push(row);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;
  return { db, rows };
}

const out = { waMessageId: "wamid.1", type: "text", body: "Hi", raw: {}, businessNumberId: "100" };

describe("saving messages", () => {
  it("saves which of our numbers a message went through", async () => {
    const { db, rows } = fakeDb(true);
    await createSupabaseStore(db).recordOutbound("contact-1", out);
    expect(rows[0]).toMatchObject({ business_number_id: "100", body: "Hi" });
  });

  it("still saves the message if migration 0015 hasn't been run yet", async () => {
    const { db, rows } = fakeDb(false);
    await createSupabaseStore(db).recordOutbound("contact-1", out);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("business_number_id");
  });
});

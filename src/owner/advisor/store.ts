import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdvisorOrder } from "./numbers.js";
import type { Answer, QuestionId } from "./index.js";

// What the business advisor reads and keeps (migration 0093): the last
// year's orders, and each answer it gives, so a question asked again soon
// shows the saved answer and the month's written answers can be counted.

export interface AdvisorStore {
  /** Confirmed and paid orders since then, with their lines. */
  orders(since: Date): Promise<AdvisorOrder[]>;
  /** The latest answer to this question given since then, or null. */
  recent(question: QuestionId, since: Date): Promise<Answer | null>;
  /** Answers with written advice given since then. */
  written(since: Date): Promise<number>;
  save(answer: Answer, ai: boolean): Promise<void>;
}

export function createSupabaseAdvisorStore(db: SupabaseClient, businessId: string, businessIds: string[]): AdvisorStore {
  return {
    async orders(since) {
      const { data, error } = await db
        .from("quote_orders")
        .select("contact_id, total_kobo, confirmed_at, paid_at, status, contacts(wa_id, name), quote_order_items(variant_id, name, quantity, total_kobo, unit_cost_kobo)")
        .in("business_id", businessIds)
        .in("status", ["confirmed", "paid"])
        .gte("confirmed_at", since.toISOString())
        .order("confirmed_at", { ascending: false })
        .limit(10_000);
      if (error) throw new Error(`advisor orders failed: ${error.message}`);
      type Row = {
        contact_id: string;
        total_kobo: number | string;
        confirmed_at: string;
        paid_at: string | null;
        status: string;
        contacts: { wa_id: string; name: string | null } | null;
        quote_order_items: Array<{ variant_id: string | null; name: string; quantity: number; total_kobo: number | string; unit_cost_kobo: number | string | null }>;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        customerId: r.contact_id,
        name: r.contacts?.name ?? null,
        waId: r.contacts?.wa_id ?? "",
        confirmedAt: new Date(r.confirmed_at),
        // A paid order from before paid_at was saved counts as paid when it was confirmed.
        paidAt: r.paid_at ? new Date(r.paid_at) : r.status === "paid" ? new Date(r.confirmed_at) : null,
        totalKobo: Number(r.total_kobo),
        lines: r.quote_order_items.map((i) => ({
          variantId: i.variant_id,
          name: i.name,
          quantity: Number(i.quantity),
          totalKobo: Number(i.total_kobo),
          unitCostKobo: i.unit_cost_kobo == null ? null : Number(i.unit_cost_kobo),
        })),
      }));
    },
    async recent(question, since) {
      const { data, error } = await db
        .from("quote_advisor_answers")
        .select("answer")
        .eq("business_id", businessId)
        .eq("question", question)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`advisor recent failed: ${error.message}`);
      return (data?.answer as Answer | undefined) ?? null;
    },
    async written(since) {
      const { count, error } = await db
        .from("quote_advisor_answers")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("ai", true)
        .gte("created_at", since.toISOString());
      if (error) throw new Error(`advisor count failed: ${error.message}`);
      return count ?? 0;
    },
    async save(answer, ai) {
      const { error } = await db.from("quote_advisor_answers").insert({ business_id: businessId, question: answer.question, answer, ai });
      if (error) throw new Error(`advisor save failed: ${error.message}`);
    },
  };
}

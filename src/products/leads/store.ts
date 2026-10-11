import type { SupabaseClient } from "@supabase/supabase-js";
import type { Financing, LeadDetails, Purpose, Temperature, Timeline } from "./qualify.js";

// Reading and saving leads. Kept behind an interface so tests can use an
// in-memory version instead of a real database.

export type LeadStatus = "qualifying" | "qualified" | "handed_off";

export interface Lead extends LeadDetails {
  id: string;
  waId: string;
  wantsAgent: boolean;
  score: number;
  temperature: Temperature;
  status: LeadStatus;
  alertedAt: Date | null;
  updatedAt: Date;
}

export type LeadUpdate = LeadDetails & {
  wantsAgent: boolean;
  score: number;
  temperature: Temperature;
  status: LeadStatus;
};

export interface LeadStore {
  /** The lead for this WhatsApp number, or null if they haven't enquired before. */
  findLead(waId: string): Promise<Lead | null>;
  /** Creates or updates the lead for this WhatsApp number. */
  saveLead(waId: string, lead: LeadUpdate): Promise<Lead>;
  /**
   * Marks the lead as handed to an agent. Returns false if that already
   * happened, in which case agents must not be alerted again.
   */
  claimAlert(leadId: string): Promise<boolean>;
  /** The most recently active leads, newest first. */
  recentLeads(limit: number): Promise<Lead[]>;
}

const COLUMNS =
  "id, wa_id, name, purpose, property_type, location, budget_kobo, timeline, financing, wants_agent, score, temperature, status, alerted_at, updated_at";

function toLead(row: Record<string, unknown>): Lead {
  return {
    id: row.id as string,
    waId: row.wa_id as string,
    name: (row.name as string | null) ?? null,
    purpose: (row.purpose as Purpose | null) ?? null,
    propertyType: (row.property_type as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    // bigint can come back as a string; budgets are well within safe integer range.
    budgetKobo: row.budget_kobo === null || row.budget_kobo === undefined ? null : Number(row.budget_kobo),
    timeline: (row.timeline as Timeline | null) ?? null,
    financing: (row.financing as Financing | null) ?? null,
    wantsAgent: Boolean(row.wants_agent),
    score: Number(row.score),
    temperature: row.temperature as Temperature,
    status: row.status as LeadStatus,
    alertedAt: row.alerted_at ? new Date(row.alerted_at as string) : null,
    updatedAt: new Date(row.updated_at as string),
  };
}

export function createSupabaseLeadStore(db: SupabaseClient): LeadStore {
  return {
    async findLead(waId) {
      const { data, error } = await db.from("lead_leads").select(COLUMNS).eq("wa_id", waId).maybeSingle();
      if (error) throw new Error(`findLead failed: ${error.message}`);
      return data ? toLead(data) : null;
    },

    async saveLead(waId, l) {
      const { data, error } = await db
        .from("lead_leads")
        .upsert(
          {
            wa_id: waId,
            name: l.name,
            purpose: l.purpose,
            property_type: l.propertyType,
            location: l.location,
            budget_kobo: l.budgetKobo,
            timeline: l.timeline,
            financing: l.financing,
            wants_agent: l.wantsAgent,
            score: l.score,
            temperature: l.temperature,
            status: l.status,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "wa_id" },
        )
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`saveLead failed: ${error.message}`);
      return toLead(data);
    },

    async claimAlert(leadId) {
      // Only succeeds for the first caller: the row must not have been alerted yet.
      const { data, error } = await db
        .from("lead_leads")
        .update({ alerted_at: new Date().toISOString(), status: "handed_off" })
        .eq("id", leadId)
        .is("alerted_at", null)
        .select("id");
      if (error) throw new Error(`claimAlert failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async recentLeads(limit) {
      const { data, error } = await db
        .from("lead_leads")
        .select(COLUMNS)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`recentLeads failed: ${error.message}`);
      return (data ?? []).map(toLead);
    },
  };
}

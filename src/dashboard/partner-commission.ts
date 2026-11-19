import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira, parseMoney } from "../core/money.js";
import { esc } from "./page.js";
import type { Partner } from "./partners.js";

// Commission for a partner who sells yarnOga (e.g. a city lead): a share of
// every plan payment from the shops that signed up with their code, for each
// shop's first months (counted from its first plan payment). It's earned only
// once the shop has paid, and worked out here from the payments table, so
// nothing the bot says can change it. Naira payments only, in kobo.

export const COMMISSION_MONTHS = 12;

export interface CommissionShop {
  id: string;
  name: string;
  planCode: string | null;
}

export interface PlanPayment {
  businessId: string;
  amountKobo: number;
  paidAt: string;
}

export interface CommissionRow {
  shop: CommissionShop;
  /** What the shop paid for its plan inside its commission months. */
  paidKobo: number;
  commissionKobo: number;
  /** Last day of its commission months (Lagos), or null before its first payment. */
  until: string | null;
}

export interface Commission {
  percent: number | null;
  /** What has been paid out to the partner so far, typed in on the dashboard. */
  paidOutKobo: number;
  rows: CommissionRow[];
  earnedKobo: number;
}

function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function workOutCommission(percent: number | null, paidOutKobo: number, shops: CommissionShop[], payments: PlanPayment[]): Commission {
  const rows = shops.map((shop) => {
    const own = payments.filter((p) => p.businessId === shop.id).sort((a, b) => a.paidAt.localeCompare(b.paidAt));
    if (!own.length) return { shop, paidKobo: 0, commissionKobo: 0, until: null };
    const end = addMonths(own[0]!.paidAt, COMMISSION_MONTHS);
    const counted = own.filter((p) => new Date(p.paidAt) < end);
    const paidKobo = counted.reduce((sum, p) => sum + p.amountKobo, 0);
    return {
      shop,
      paidKobo,
      // Each payment rounded down to the kobo, so the total never runs over.
      commissionKobo: percent ? counted.reduce((sum, p) => sum + Math.floor((p.amountKobo * percent) / 100), 0) : 0,
      until: new Date(end.getTime() - 86_400_000 + 3_600_000).toISOString().slice(0, 10),
    };
  });
  rows.sort((a, b) => b.paidKobo - a.paidKobo || a.shop.name.localeCompare(b.shop.name));
  return { percent, paidOutKobo, rows, earnedKobo: rows.reduce((sum, r) => sum + r.commissionKobo, 0) };
}

export interface CommissionInput {
  percent: number | null;
  paidOutKobo: number;
}

export function parseCommissionForm(form: Record<string, unknown>): CommissionInput | { problem: string } {
  const text = (name: string) => (typeof form[name] === "string" ? (form[name] as string).trim() : "");
  const percent = text("commission_percent");
  if (percent && (!/^\d{1,2}$/.test(percent) || Number(percent) < 1)) return { problem: "Commission should be a whole number from 1 to 99, or empty for none." };
  const paid = text("paid_out");
  const paidOutKobo = paid ? parseMoney(paid) : 0;
  if (paidOutKobo === null || paidOutKobo < 0) return { problem: "Type what you've paid them so far in naira, e.g. 5750." };
  return { percent: percent ? Number(percent) : null, paidOutKobo };
}

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "₦5,750 owed" for the folded part's heading. */
export function commissionState(c: Commission | "error" | undefined): string {
  if (!c || c === "error" || !c.percent) return c === "error" ? "" : "not set";
  const owed = c.earnedKobo - c.paidOutKobo;
  return owed > 0 ? `${formatNaira(owed)} owed` : `${formatNaira(c.earnedKobo)} earned`;
}

export function renderCommission(p: Partner, c: Commission | "error" | undefined): string {
  if (c === "error") return `<p class="problem">Couldn't work out the commission. If 0096_partner_commission.sql hasn't been run in Supabase yet, run it.</p>`;
  const percent = c?.percent ?? null;
  const owed = c ? c.earnedKobo - c.paidOutKobo : 0;
  const table =
    c && percent
      ? c.rows.length
        ? `<div class="scroll"><table><thead><tr><th>Shop</th><th>Plan</th><th>Paid for plans</th><th>Commission</th><th>Counts until</th></tr></thead><tbody>${c.rows
            .map(
              (r) =>
                `<tr><td>${esc(r.shop.name)}</td><td>${esc(r.shop.planCode ?? "free")}</td><td>${formatNaira(r.paidKobo)}</td><td>${formatNaira(r.commissionKobo)}</td><td>${r.until ? esc(day(r.until)) : "not paid yet"}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : `<p class="small">No shop has signed up with ${esc(p.promoCode ?? "their code")} yet.</p>`
      : "";
  const totals =
    c && percent
      ? `<p class="pk-line">Earned ${formatNaira(c.earnedKobo)} · paid to them ${formatNaira(c.paidOutKobo)} · <b>${owed > 0 ? `${formatNaira(owed)} still owed` : "nothing owed"}</b></p>`
      : "";
  return `<form class="entry" method="post" action="/dashboard/partners/${p.id}/commission">
<h3>Commission</h3>
<p class="small wide-all">For someone who sells yarnOga for us: their share of every plan payment from shops that signed up with their code, for each shop's first ${COMMISSION_MONTHS} months from its first payment. It counts only money that has come in, in naira.</p>
${totals ? `<div class="wide-all">${totals}${table}</div>` : ""}
<label>Commission (%) <input name="commission_percent" type="number" min="1" max="99" value="${percent ?? ""}" placeholder="Empty = none"></label>
<label>Paid to them so far (₦) <input name="paid_out" inputmode="decimal" value="${c?.paidOutKobo ? (c.paidOutKobo / 100).toFixed(0) : ""}" placeholder="0"></label>
<p class="small wide-all">Each time you pay them, add it to "Paid to them so far" so what's owed stays right.</p>
<div class="buttons"><button type="submit">Save commission</button></div>
</form>`;
}

export async function loadCommission(db: SupabaseClient, p: Partner): Promise<Commission> {
  const percent = p.commissionPercent ?? null;
  const paidOut = p.commissionPaidKobo ?? 0;
  if (!percent || !p.promoCode) return workOutCommission(percent, paidOut, [], []);
  const { data: shops, error } = await db.from("quote_businesses").select("id, name, plan_code").eq("referral_code", p.promoCode);
  if (error) throw new Error(`commission shops failed: ${error.message}`);
  const list = (shops ?? []).map((s) => ({ id: s.id as string, name: s.name as string, planCode: (s.plan_code as string | null) ?? null }));
  if (!list.length) return workOutCommission(percent, paidOut, [], []);
  const { data: paid, error: payError } = await db
    .from("payments")
    .select("amount_kobo, paid_at, currency, purpose")
    .eq("product", "quote")
    .eq("status", "paid")
    .not("purpose->>plan", "is", null)
    .in(
      "purpose->>businessId",
      list.map((s) => s.id),
    );
  if (payError) throw new Error(`commission payments failed: ${payError.message}`);
  const payments = (paid ?? [])
    .filter((r) => (!r.currency || r.currency === "NGN") && r.paid_at)
    .map((r) => ({ businessId: (r.purpose as { businessId: string }).businessId, amountKobo: Number(r.amount_kobo), paidAt: r.paid_at as string }));
  return workOutCommission(percent, paidOut, list, payments);
}

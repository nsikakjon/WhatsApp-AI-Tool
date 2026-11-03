import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertKobo, formatNaira } from "../core/money.js";
import type { PaystackTransfer, PaystackTransfers } from "../core/payments/paystack.js";

// Paying a shop's riders and staff from the owner app (QUOTE_PAYOUTS,
// migration 0066). Shop sales settle straight to the shop's bank, so the
// shop first adds money to a payout balance held in yarnOga's Paystack
// account; each payment comes off that balance by Paystack Transfer.
//
// Sending takes two steps: a draft shows the person, account, amount and fee
// on a confirm screen, and only "Yes, send" moves money. The database takes
// the amount off the balance and marks the payout 'sending' in one step
// (payout_start), so a double tap or two open tabs can't pay twice.

export type PayoutStatus = "draft" | "sending" | "pending" | "otp" | "success" | "failed" | "reversed";

export interface Recipient {
  id: string;
  riderId: string | null;
  userId: string | null;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  recipientCode: string;
}

export interface Payout {
  id: string;
  reference: string;
  recipientId: string;
  payeeName: string;
  payeeWaId: string | null;
  accountLabel: string;
  amountKobo: number;
  feeKobo: number;
  reason: string;
  deliveryId: string | null;
  status: PayoutStatus;
  failure: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

/** A delivered order whose rider hasn't been paid for it from the app. */
export interface UnpaidDelivery {
  id: string;
  orderRef: string;
  riderId: string;
  riderName: string;
  feeKobo: number | null;
  deliveredAt: Date;
}

export type NewPayout = Pick<Payout, "recipientId" | "payeeName" | "payeeWaId" | "accountLabel" | "amountKobo" | "feeKobo" | "reason" | "deliveryId"> & {
  recipientCode: string;
  createdBy: string | null;
};

export type StartResult = "ok" | "low" | "expired" | "gone" | "paid";

export interface PayoutStore {
  balance(): Promise<number>;
  recipients(): Promise<Recipient[]>;
  saveRecipient(r: Omit<Recipient, "id">): Promise<void>;
  /** Paystack's charge for sending this amount (payout_transfer_fees). */
  transferFee(amountKobo: number): Promise<number>;
  draft(p: NewPayout & { reference: string }): Promise<string>;
  get(id: string): Promise<(Payout & { recipientCode: string }) | null>;
  recent(limit: number): Promise<Payout[]>;
  unpaidDeliveries(since: Date): Promise<UnpaidDelivery[]>;
  start(id: string): Promise<StartResult>;
  finish(id: string, status: PayoutStatus, transferCode: string | null, failure: string | null): Promise<boolean>;
  /** Adds a paid top-up to the balance; false if that payment was counted already. */
  credit(paymentReference: string, amountKobo: number): Promise<boolean>;
}

/** Any payout in the whole system, for Paystack's webhook. */
export interface PayoutLookup {
  byReference(reference: string): Promise<{ businessId: string; id: string; status: PayoutStatus; sentAt: Date | null } | null>;
}

export type SendResult = StartResult | "sent" | "pending" | "otp" | "failed" | "unsure";

export interface PayoutsDeps {
  store: PayoutStore;
  transfers: PaystackTransfers;
  /** Tells the person paid, on WhatsApp from the business's number. Failures are only logged. */
  tellPayee?(waId: string, text: string): Promise<void>;
  businessName: string;
  now?: () => Date;
  log?: Pick<Console, "info" | "warn" | "error">;
}

/** A transfer still 'sending' this long after we asked, and unknown to Paystack, never reached it. */
const LOST_AFTER_MS = 10 * 60_000;

export const MIN_PAYOUT_KOBO = 10_000;
export const MIN_TOPUP_KOBO = 100_000;

export function newTransferReference(): string {
  return `yarnoga-pay-${randomUUID()}`;
}

export function statusFromPaystack(t: PaystackTransfer): PayoutStatus {
  switch (t.status) {
    case "success":
      return "success";
    case "otp":
      return "otp";
    case "failed":
    case "abandoned":
    case "rejected":
    case "blocked":
      return "failed";
    case "reversed":
      return "reversed";
    default:
      // "pending", "received", "processing", "queued"
      return "pending";
  }
}

export function createPayouts(deps: PayoutsDeps) {
  const log = deps.log ?? console;
  const now = () => (deps.now ? deps.now() : new Date());

  async function record(p: Payout, t: PaystackTransfer): Promise<PayoutStatus> {
    const status = statusFromPaystack(t);
    const changed = await deps.store.finish(p.id, status, t.transferCode, status === "failed" || status === "reversed" ? (t.failure ?? `Paystack said ${t.status}`) : null);
    if (changed && status === "success" && p.payeeWaId && deps.tellPayee) {
      const text = `${deps.businessName} has sent you ${formatNaira(p.amountKobo)} (${p.reason}) to ${p.accountLabel}. It should be in your account shortly.`;
      await deps.tellPayee(p.payeeWaId, text).catch((err) => log.warn(`Payout ${p.reference}: couldn't tell the payee:`, err));
    }
    if (changed && status === "otp") log.error(`Payout ${p.reference} is waiting for an OTP: switch off the transfer OTP in Paystack > Settings > Preferences`);
    return status;
  }

  return {
    store: deps.store,

    /** Step one: saves what the confirm screen shows. Nothing is sent. */
    async draft(p: Omit<NewPayout, "feeKobo">): Promise<string> {
      assertKobo(p.amountKobo);
      if (p.amountKobo < MIN_PAYOUT_KOBO) throw new Error("Payout below the minimum");
      const feeKobo = await deps.store.transferFee(p.amountKobo);
      return deps.store.draft({ ...p, feeKobo, reference: newTransferReference() });
    },

    /** Step two, after "Yes, send": takes the money off the balance, then asks Paystack to send it. */
    async send(id: string): Promise<SendResult> {
      const started = await deps.store.start(id);
      if (started !== "ok") return started;
      const p = (await deps.store.get(id))!;
      let t: PaystackTransfer;
      try {
        t = await deps.transfers.send({ reference: p.reference, amountKobo: p.amountKobo, recipientCode: p.recipientCode, reason: p.reason });
      } catch (err) {
        // We don't know if Paystack got it. The webhook, or Check again, will say.
        log.error(`Payout ${p.reference}: Paystack didn't answer clearly:`, err);
        return "unsure";
      }
      const status = await record(p, t);
      log.info(`Payout ${p.reference} of ${p.amountKobo} kobo: ${status}`);
      if (status === "success") return "sent";
      if (status === "failed" || status === "reversed") return "failed";
      return status === "pending" || status === "otp" ? status : "unsure";
    },

    /** Asks Paystack about a payout that isn't finished, and records the answer. */
    async check(id: string): Promise<PayoutStatus | null> {
      const p = await deps.store.get(id);
      if (!p) return null;
      if (!["sending", "pending", "otp", "success"].includes(p.status)) return p.status;
      const t = await deps.transfers.verify(p.reference);
      if (!t) {
        // Paystack never got it: give the money back, but only once we're sure it isn't on its way.
        if (p.status === "sending" && p.sentAt && now().getTime() - p.sentAt.getTime() > LOST_AFTER_MS) {
          await deps.store.finish(p.id, "failed", null, "Paystack never received this transfer");
          return "failed";
        }
        return p.status;
      }
      return record(p, t);
    },
  };
}

export type Payouts = ReturnType<typeof createPayouts>;

// ---- Supabase ----

const PAYOUT_COLUMNS =
  "id, reference, recipient_id, payee_name, payee_wa_id, account_label, recipient_code, amount_kobo, fee_kobo, reason, delivery_id, status, failure, created_at, sent_at";

function toPayout(r: Record<string, unknown>): Payout & { recipientCode: string } {
  return {
    id: r.id as string,
    reference: r.reference as string,
    recipientId: r.recipient_id as string,
    payeeName: r.payee_name as string,
    payeeWaId: (r.payee_wa_id as string | null) ?? null,
    accountLabel: r.account_label as string,
    recipientCode: r.recipient_code as string,
    amountKobo: Number(r.amount_kobo),
    feeKobo: Number(r.fee_kobo),
    reason: r.reason as string,
    deliveryId: (r.delivery_id as string | null) ?? null,
    status: r.status as PayoutStatus,
    failure: (r.failure as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    sentAt: r.sent_at ? new Date(r.sent_at as string) : null,
  };
}

function rows<T>(data: T[] | null, error: { message: string } | null, what: string): T[] {
  if (error) throw new Error(`${what} failed: ${error.message}`);
  return data ?? [];
}

export function createSupabasePayoutStore(db: SupabaseClient, businessId: string): PayoutStore {
  return {
    async balance() {
      const { data, error } = await db.from("payout_ledger").select("amount_kobo").eq("business_id", businessId);
      return rows(data, error, "payout balance").reduce((sum, r) => sum + Number(r.amount_kobo), 0);
    },

    async recipients() {
      const { data, error } = await db
        .from("payout_recipients")
        .select("id, rider_id, app_user_id, bank_code, bank_name, account_number, account_name, recipient_code")
        .eq("business_id", businessId);
      return rows(data, error, "payout recipients").map((r) => ({
        id: r.id as string,
        riderId: (r.rider_id as string | null) ?? null,
        userId: (r.app_user_id as string | null) ?? null,
        bankCode: r.bank_code as string,
        bankName: r.bank_name as string,
        accountNumber: r.account_number as string,
        accountName: r.account_name as string,
        recipientCode: r.recipient_code as string,
      }));
    },

    async saveRecipient(r) {
      const row = {
        business_id: businessId,
        rider_id: r.riderId,
        app_user_id: r.userId,
        bank_code: r.bankCode,
        bank_name: r.bankName,
        account_number: r.accountNumber,
        account_name: r.accountName,
        recipient_code: r.recipientCode,
        updated_at: new Date().toISOString(),
      };
      const column = r.riderId ? "rider_id" : "app_user_id";
      const { data: existing, error: e1 } = await db.from("payout_recipients").select("id").eq("business_id", businessId).eq(column, r.riderId ?? r.userId).maybeSingle();
      if (e1) throw new Error(`payout recipient lookup failed: ${e1.message}`);
      const { error } = existing
        ? await db.from("payout_recipients").update(row).eq("id", existing.id)
        : await db.from("payout_recipients").insert(row);
      if (error) throw new Error(`saving payout recipient failed: ${error.message}`);
    },

    async transferFee(amountKobo) {
      const { data, error } = await db.from("payout_transfer_fees").select("up_to_kobo, fee_kobo");
      const tiers = rows(data, error, "transfer fees")
        .map((t) => ({ upTo: t.up_to_kobo === null ? Infinity : Number(t.up_to_kobo), fee: Number(t.fee_kobo) }))
        .sort((a, b) => a.upTo - b.upTo);
      const tier = tiers.find((t) => amountKobo <= t.upTo);
      if (!tier) throw new Error("No transfer fee set for this amount (payout_transfer_fees)");
      return tier.fee;
    },

    async draft(p) {
      const { data, error } = await db
        .from("payouts")
        .insert({
          business_id: businessId,
          reference: p.reference,
          recipient_id: p.recipientId,
          payee_name: p.payeeName,
          payee_wa_id: p.payeeWaId,
          account_label: p.accountLabel,
          recipient_code: p.recipientCode,
          amount_kobo: p.amountKobo,
          fee_kobo: p.feeKobo,
          reason: p.reason,
          delivery_id: p.deliveryId,
          created_by: p.createdBy,
        })
        .select("id")
        .single();
      if (error) throw new Error(`payout draft failed: ${error.message}`);
      return data.id as string;
    },

    async get(id) {
      const { data, error } = await db.from("payouts").select(PAYOUT_COLUMNS).eq("business_id", businessId).eq("id", id).maybeSingle();
      if (error) throw new Error(`payout lookup failed: ${error.message}`);
      return data ? toPayout(data) : null;
    },

    async recent(limit) {
      const { data, error } = await db
        .from("payouts")
        .select(PAYOUT_COLUMNS)
        .eq("business_id", businessId)
        .neq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(limit);
      return rows(data, error, "payouts").map(toPayout);
    },

    async unpaidDeliveries(since) {
      const { data, error } = await db
        .from("quote_deliveries")
        .select("id, order_ref, rider_id, rider_name, fee_kobo, delivered_at")
        .eq("business_id", businessId)
        .eq("status", "delivered")
        .not("rider_id", "is", null)
        .gte("delivered_at", since.toISOString())
        .order("delivered_at", { ascending: false })
        .limit(100);
      const delivered = rows(data, error, "delivered orders");
      if (!delivered.length) return [];
      const { data: paid, error: e2 } = await db
        .from("payouts")
        .select("delivery_id")
        .in("delivery_id", delivered.map((d) => d.id))
        .in("status", ["sending", "pending", "otp", "success"]);
      const done = new Set(rows(paid, e2, "delivery payouts").map((p) => p.delivery_id as string));
      return delivered
        .filter((d) => !done.has(d.id as string))
        .map((d) => ({
          id: d.id as string,
          orderRef: d.order_ref as string,
          riderId: d.rider_id as string,
          riderName: (d.rider_name as string | null) ?? "Rider",
          feeKobo: d.fee_kobo === null ? null : Number(d.fee_kobo),
          deliveredAt: new Date(d.delivered_at as string),
        }));
    },

    async start(id) {
      const { data, error } = await db.rpc("payout_start", { p_id: id, p_business_id: businessId });
      if (error) throw new Error(`payout_start failed: ${error.message}`);
      return data as StartResult;
    },

    async finish(id, status, transferCode, failure) {
      const { data, error } = await db.rpc("payout_finish", { p_id: id, p_status: status, p_transfer_code: transferCode, p_failure: failure });
      if (error) throw new Error(`payout_finish failed: ${error.message}`);
      return data === true;
    },

    async credit(paymentReference, amountKobo) {
      assertKobo(amountKobo);
      const { error } = await db.from("payout_ledger").insert({ business_id: businessId, kind: "topup", amount_kobo: amountKobo, payment_reference: paymentReference });
      if (error?.code === "23505") return false;
      if (error) throw new Error(`payout top-up failed: ${error.message}`);
      return true;
    },
  };
}

export function createSupabasePayoutLookup(db: SupabaseClient): PayoutLookup {
  return {
    async byReference(reference) {
      const { data, error } = await db.from("payouts").select("id, business_id, status, sent_at").eq("reference", reference).maybeSingle();
      if (error) throw new Error(`payout lookup failed: ${error.message}`);
      return data
        ? { id: data.id as string, businessId: data.business_id as string, status: data.status as PayoutStatus, sentAt: data.sent_at ? new Date(data.sent_at as string) : null }
        : null;
    },
  };
}

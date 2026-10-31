import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lang } from "../../core/i18n.js";
import type { Notice } from "../../core/product.js";
import { lagosHour } from "./followups.js";

// Plan renewals (QUOTE_PLAN_RENEWALS, migration 0064).
//
// Plans are paid by Paystack link for a month or a year at a time, so there is
// no card to charge again: "renewing" means the owner pays a fresh link. A
// payment that fails on the Paystack page can simply be tried again there,
// and every reminder below carries new one-tap Renew buttons.
//
// 1. Three days before the plan ends, the owner is reminded.
// 2. When it ends unpaid, the business keeps its plan for a grace period
//    (QUOTE_PLAN_GRACE_DAYS, 3 by default) and the owner is told so.
// 3. On the last day of the grace period, one more reminder.
// 4. Once it's over, the business is on Free; the owner and yarnOga hear.
//
// Each step is sent at most once per paid period (the end date it's about is
// saved with it), daytime only. If WhatsApp won't let us reach the owner (they
// haven't messaged their bot in the last day), yarnOga is told instead so
// someone can call them.

export interface RenewalBusiness {
  id: string;
  name: string;
  planCode: string;
  planName: string;
  paidUntil: Date;
  graceUntil: Date | null;
  /** The end date the last reminder was about, and which step it was. */
  noticeFor: Date | null;
  noticeStep: number;
}

export interface RenewalStore {
  /** Paid plans ending in the next 3 days or ended in the last 30 (branches follow their main business). */
  due(now: Date): Promise<RenewalBusiness[]>;
  setGrace(businessId: string, paidUntil: Date, graceUntil: Date): Promise<void>;
  /** Marks this step as sent for this end date; false if it already was. */
  claim(businessId: string, paidUntil: Date, step: number): Promise<boolean>;
}

export interface RenewalDeps {
  store: RenewalStore;
  graceDays: number;
  /** The owner's number, the business's number and language, or null when the bot isn't running. */
  owner(businessId: string): Promise<{ waId: string; fromNumberId?: string; language?: Lang } | null>;
  canMessageFreely(waId: string): Promise<boolean>;
  send(note: Notice, fromNumberId?: string): Promise<void>;
  /** yarnOga's own alert (QUOTE_SIGNUP_ALERT_WA_ID, else QUOTE_OWNER_WA_ID). */
  alertYarnoga?(text: string): Promise<void>;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const DAY = 86_400_000;
const REMIND_BEFORE_DAYS = 3;
/** Plans that ended longer ago than this (e.g. before the switch went on) are left alone. */
const LATE_LIMIT_DAYS = 7;

/** Which step is due now: 0 none, 1 ending soon, 2 ended (grace), 3 last grace day, 4 moved to Free. */
export function renewalStep(paidUntil: Date, graceDays: number, now: Date): number {
  const end = paidUntil.getTime();
  const graceEnd = end + graceDays * DAY;
  const t = now.getTime();
  if (t < end - REMIND_BEFORE_DAYS * DAY) return 0;
  if (t < end) return 1;
  if (t < graceEnd - DAY) return 2;
  if (t < graceEnd) return 3;
  return t < graceEnd + LATE_LIMIT_DAYS * DAY ? 4 : 0;
}

const day = (d: Date, lang: Lang) =>
  d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", timeZone: "Africa/Lagos" });

export function renewalNotice(b: RenewalBusiness, step: number, graceUntil: Date, to: string, lang: Lang = "en"): Notice {
  const ended = day(b.paidUntil, lang);
  const freeFrom = day(graceUntil, lang);
  const plan = `*${b.planName}*`;
  const fr = lang === "fr";
  const body =
    step === 1
      ? fr
        ? `Votre formule ${plan} se termine le ${ended}. Touchez un bouton pour la renouveler.`
        : `Your ${plan} plan ends on ${ended}. Tap a button to renew it.`
      : step === 2
        ? fr
          ? `Votre formule ${plan} s'est terminée le ${ended} et le renouvellement n'est pas encore payé. Tout continue de marcher jusqu'au ${freeFrom}, puis votre bot passera à la formule Free.`
          : `Your ${plan} plan ended on ${ended} and the renewal hasn't been paid yet. Everything keeps working until ${freeFrom}, then your bot moves to the Free plan.`
        : step === 3
          ? fr
            ? `Dernier jour : votre bot passe à la formule Free le ${freeFrom} si la formule ${plan} n'est pas renouvelée.`
            : `Last day: your bot moves to the Free plan on ${freeFrom} unless ${plan} is renewed.`
          : fr
            ? `Votre bot est maintenant sur la formule Free. Touchez un bouton pour revenir à ${plan} quand vous voulez.`
            : `Your bot is now on the Free plan. Tap a button to go back to ${plan} any time.`;
  const name = b.planName.toLowerCase();
  return {
    to,
    text: "",
    buttons: {
      body,
      buttons: [
        { id: `upgrade ${name}`, title: fr ? "Renouveler 1 mois" : "Renew for a month" },
        { id: `upgrade ${name} yearly`, title: fr ? "Renouveler 1 an" : "Renew for a year" },
      ],
    },
  };
}

export async function sendRenewalReminders(deps: RenewalDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? console;
  for (const b of await deps.store.due(now)) {
    try {
      const step = renewalStep(b.paidUntil, deps.graceDays, now);
      if (step === 0) continue;
      // The grace period is saved straight away, day or night, so the plan
      // doesn't lapse at its end date while the reminders wait for morning.
      const graceUntil = new Date(b.paidUntil.getTime() + deps.graceDays * DAY);
      if (b.graceUntil?.getTime() !== graceUntil.getTime()) await deps.store.setGrace(b.id, b.paidUntil, graceUntil);

      const already = b.noticeFor?.getTime() === b.paidUntil.getTime() ? b.noticeStep : 0;
      const hour = lagosHour(now);
      if (step <= already || hour < 8 || hour >= 20) continue;
      if (!(await deps.store.claim(b.id, b.paidUntil, step))) continue;

      const owner = await deps.owner(b.id);
      const reachable = owner ? await deps.canMessageFreely(owner.waId) : false;
      if (owner && reachable) await deps.send(renewalNotice(b, step, graceUntil, owner.waId, owner.language), owner.fromNumberId);
      const contact = owner ? `+${owner.waId}` : "no owner number";
      if (step === 4) {
        await deps.alertYarnoga?.(`${b.name} didn't renew ${b.planName} (ended ${day(b.paidUntil, "en")}) and is now on Free. Owner: ${contact}.`);
      } else if (!reachable) {
        await deps.alertYarnoga?.(
          `Couldn't remind ${b.name} on WhatsApp (they haven't messaged their bot in the last day): ${b.planName} ${step === 1 ? "ends" : "ended"} on ${day(b.paidUntil, "en")}, Free from ${day(graceUntil, "en")}. Owner: ${contact}. Worth a call.`,
        );
      }
    } catch (err) {
      log.error(`Renewal reminder for ${b.name} failed:`, err);
    }
  }
}

export function createSupabaseRenewals(db: SupabaseClient): RenewalStore {
  return {
    async due(now) {
      const { data, error } = await db
        .from("quote_businesses")
        .select("id, name, plan_code, plan_paid_until, plan_grace_until, renewal_notice_for, renewal_notice_step, branch_of")
        .not("plan_code", "is", null)
        .neq("plan_code", "free")
        .is("branch_of", null)
        .gte("plan_paid_until", new Date(now.getTime() - 30 * DAY).toISOString())
        .lte("plan_paid_until", new Date(now.getTime() + REMIND_BEFORE_DAYS * DAY).toISOString());
      if (error) throw new Error(`renewals due failed: ${error.message}`);
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const { data: plans, error: planError } = await db.from("quote_plans").select("code, name");
      if (planError) throw new Error(`renewal plans failed: ${planError.message}`);
      const names = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]));
      return rows.map((r) => ({
        id: r.id as string,
        name: r.name as string,
        planCode: r.plan_code as string,
        planName: names.get(r.plan_code as string) ?? (r.plan_code as string),
        paidUntil: new Date(r.plan_paid_until as string),
        graceUntil: r.plan_grace_until ? new Date(r.plan_grace_until as string) : null,
        noticeFor: r.renewal_notice_for ? new Date(r.renewal_notice_for as string) : null,
        noticeStep: Number(r.renewal_notice_step ?? 0),
      }));
    },

    async setGrace(businessId, paidUntil, graceUntil) {
      // Only for the same end date, so a payment that just came in isn't undone.
      const { error } = await db
        .from("quote_businesses")
        .update({ plan_grace_until: graceUntil.toISOString() })
        .eq("id", businessId)
        .eq("plan_paid_until", paidUntil.toISOString());
      if (error) throw new Error(`setGrace failed: ${error.message}`);
    },

    async claim(businessId, paidUntil, step) {
      const until = paidUntil.toISOString();
      const { data, error } = await db
        .from("quote_businesses")
        .update({ renewal_notice_for: until, renewal_notice_step: step })
        .eq("id", businessId)
        .eq("plan_paid_until", until)
        .or(`renewal_notice_for.is.null,renewal_notice_for.neq."${until}",renewal_notice_step.lt.${step}`)
        .select("id");
      if (error) throw new Error(`renewal claim failed: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}

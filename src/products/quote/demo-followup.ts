import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutgoingButtons } from "../../core/whatsapp/client.js";
import type { Signup } from "./chat-signup.js";
import { lagosHour } from "./followups.js";

// One follow-up for people who chatted to the yarnOga quotes number (the Demo
// Shop and sign-up line, often straight from an ad) and went quiet without
// signing up. QUOTE_DEMO_FOLLOW_UP, migration 0078.
//
// - Sent once per person, ever. The person is marked before the message goes,
//   so a crash or a second server can't send it twice.
// - Only after 3 quiet hours and inside WhatsApp's 24-hour window, so it's an
//   ordinary message (free inside an ad's 72-hour window) and no template is needed.
// - Daytime in Lagos only. Someone who went quiet late at night hears from us
//   in the morning, while the window is still open.
// - Never to someone who has signed up, whose chat staff have taken over, or
//   to the yarnOga team's own alert number.
// - Someone part way through signing up is told where they stopped, so their
//   reply carries the sign-up on.

const QUIET_MS = 3 * 60 * 60 * 1000;
/** Last message older than this: the 24-hour window is too close to closing. */
const MAX_QUIET_MS = 22 * 60 * 60 * 1000;
const FIRST_HOUR = 8;
const LAST_HOUR = 20;

export interface QuietVisitor {
  contactId: string;
  waId: string;
  name: string | null;
}

export interface DemoFollowUpStore {
  /** People whose last message to this number came between these times and who haven't had the follow-up. */
  quiet(numberId: string, from: Date, to: Date): Promise<QuietVisitor[]>;
  /** Marks the follow-up as sent. False when it already was (another run got there first). */
  claim(contactId: string): Promise<boolean>;
}

export interface DemoFollowUpDeps {
  numberId: string;
  store: DemoFollowUpStore;
  signup: (waId: string) => Promise<Signup | null>;
  isPaused: (contactId: string) => Promise<boolean>;
  sendText: (to: string, text: string) => Promise<void>;
  sendButtons: (to: string, message: OutgoingButtons) => Promise<void>;
  /** The yarnOga team's alert number, never followed up. */
  skipWaId?: string;
  now?: Date;
  log?: Pick<Console, "error">;
}

export async function sendDemoFollowUps(deps: DemoFollowUpDeps): Promise<number> {
  const now = deps.now ?? new Date();
  const hour = lagosHour(now);
  if (hour < FIRST_HOUR || hour >= LAST_HOUR) return 0;
  const log = deps.log ?? console;
  const visitors = await deps.store.quiet(deps.numberId, new Date(now.getTime() - MAX_QUIET_MS), new Date(now.getTime() - QUIET_MS));
  let sent = 0;
  for (const v of visitors) {
    if (v.waId === deps.skipWaId) continue;
    try {
      const signup = await deps.signup(v.waId);
      if (signup?.businessId) continue;
      if (await deps.isPaused(v.contactId)) continue;
      if (!(await deps.store.claim(v.contactId))) continue;
      const message = demoFollowUp(v.name, signup);
      if (message.buttons.length) await deps.sendButtons(v.waId, message);
      else await deps.sendText(v.waId, message.body);
      sent++;
    } catch (err) {
      log.error(`Demo follow-up to ${v.contactId} failed:`, err);
    }
  }
  return sent;
}

const SIGN_UP_BUTTON = { id: "sign up", title: "Sign up free" };

/** The follow-up: where they stopped signing up (no buttons), or the offer to sign up. */
export function demoFollowUp(name: string | null, signup: Signup | null): OutgoingButtons {
  const first = name?.trim().split(/\s+/)[0];
  const hi = `Hi${first ? ` ${first}` : ""}, it's yarnOga.`;
  if (signup && signup.step !== "done") {
    const business = signup.businessName ? `*${signup.businessName}*` : "your business";
    return { body: `${hi} You're a few minutes from your own WhatsApp assistant for ${business}.\n\n${carryOn(signup)}`, buttons: [] };
  }
  return {
    body:
      `${hi} Still thinking about a WhatsApp assistant for your own business? ` +
      "It answers your customers with your own prices at any hour, sends quotes and invoices, takes orders and payment, and every order comes to you.\n\n" +
      "It's free to start and takes about 5 minutes, right here in this chat.",
    buttons: [SIGN_UP_BUTTON],
  };
}

/** The question they stopped at, so replying carries the sign-up on. */
function carryOn(s: Signup): string {
  switch (s.step) {
    case "name":
      return "What's your business called? Reply with the name to carry on.";
    case "about":
      return `In a few words, what does *${s.businessName}* sell?`;
    case "referral":
      return "Do you have a referral code? Send it, or send *no* to carry on.";
    default:
      return s.draftCsv
        ? "Your price list is ready. Reply *YES* to save it, or tell me what to change."
        : "Send your prices to finish: type them, send a voice note, or a photo of your price list.";
  }
}

export function createSupabaseDemoFollowUps(db: SupabaseClient): DemoFollowUpStore {
  return {
    async quiet(numberId, from, to) {
      const { data, error } = await db
        .from("messages")
        .select("contact_id, created_at, contacts!inner(wa_id, name)")
        .eq("business_number_id", numberId)
        .eq("direction", "inbound")
        .gte("created_at", from.toISOString())
        .order("created_at", { ascending: false })
        .limit(10_000);
      if (error) throw new Error(`reading quiet demo visitors failed: ${error.message}`);
      // Newest first, so the first row for each person is their last message.
      const last = new Map<string, QuietVisitor & { at: Date }>();
      for (const row of (data ?? []) as unknown as Array<{ contact_id: string; created_at: string; contacts: { wa_id: string; name: string | null } }>) {
        if (!last.has(row.contact_id)) {
          last.set(row.contact_id, { contactId: row.contact_id, waId: row.contacts.wa_id, name: row.contacts.name, at: new Date(row.created_at) });
        }
      }
      const quiet = [...last.values()].filter((v) => v.at <= to);
      if (!quiet.length) return [];
      const { data: done, error: doneError } = await db
        .from("quote_demo_follow_ups")
        .select("contact_id")
        .in("contact_id", quiet.map((v) => v.contactId));
      if (doneError) throw new Error(`reading demo follow-ups failed: ${doneError.message}`);
      const sent = new Set((done ?? []).map((r) => r.contact_id as string));
      return quiet.filter((v) => !sent.has(v.contactId)).map(({ at: _, ...v }) => v);
    },
    async claim(contactId) {
      const { error } = await db.from("quote_demo_follow_ups").insert({ contact_id: contactId });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error(`marking the demo follow-up failed: ${error.message}`);
    },
  };
}

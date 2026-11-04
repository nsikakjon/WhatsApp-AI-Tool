import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notice, Reply } from "../../core/product.js";
import { localNumber } from "./emails.js";

// Numbers to connect (QUOTE_NUMBER_QUEUE, migration 0071). Until Meta lets
// clients connect their own WhatsApp, each business that signs up by chat
// buys a new SIM for its bot. The sign-up chat asks for that number, and
// yarnOga staff add it to our WhatsApp account by hand from the queue on
// /quote-setup/numbers (numbers-page.ts).

export type NumberStatus = "no_number" | "new" | "added" | "registered" | "live";

export interface NumberRequest {
  businessId: string;
  businessName: string;
  /** The owner's own WhatsApp, where they signed up and get order alerts. */
  ownerWaId: string | null;
  /** The new SIM's number, digits with country code. */
  number: string | null;
  status: NumberStatus;
  assignedTo: string | null;
  phoneNumberId: string | null;
  pin: string | null;
  note: string | null;
  numberAt: Date | null;
  liveAt: Date | null;
  createdAt: Date;
}

export interface ConnectStaff {
  id: string;
  name: string;
  waId: string;
}

export type RequestChange = Partial<Pick<NumberRequest, "status" | "assignedTo" | "phoneNumberId" | "pin" | "note" | "liveAt">>;

export interface NumberQueueStore {
  /** Every request, newest number first. */
  list(): Promise<NumberRequest[]>;
  get(businessId: string): Promise<NumberRequest | null>;
  /** Puts a new business on the queue, waiting for its number. Does nothing if it's there already. */
  open(businessId: string): Promise<void>;
  /** Saves the owner's new number. False when another business already gave that number. */
  setNumber(businessId: string, number: string, assignedTo: string | null): Promise<boolean>;
  update(businessId: string, change: RequestChange): Promise<void>;
  staff(): Promise<ConnectStaff[]>;
  addStaff(name: string, waId: string): Promise<void>;
  removeStaff(id: string): Promise<void>;
}

/** Still to do: a number is in and the business isn't live yet. */
export function isOpen(r: Pick<NumberRequest, "status">): boolean {
  return r.status !== "no_number" && r.status !== "live";
}

/**
 * A phone number typed by the owner, as digits with country code, or null
 * when the message isn't one. Nigerian numbers can be written the local way
 * (0803 123 4567); others need their country code.
 */
export function phoneFromText(text: string): string | null {
  const t = text.trim();
  if (!/^\+?[\d\s().-]{7,22}$/.test(t)) return null;
  let d = t.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^0[789]\d{9}$/.test(d)) d = `234${d.slice(1)}`;
  if (d.startsWith("234")) return /^234[789]\d{9}$/.test(d) ? d : null;
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}

/** Who gets the next number: the person with the fewest still to do. */
export function nextStaff(staff: ConnectStaff[], requests: NumberRequest[]): ConnectStaff | null {
  const load = (id: string) => requests.filter((r) => r.assignedTo === id && isOpen(r)).length;
  return [...staff].sort((a, b) => load(a.id) - load(b.id))[0] ?? null;
}

export const NEW_SIM_STEPS =
  "Last step: a WhatsApp number just for your bot, so your customers can reach it.\n\n" +
  "1. Get a new SIM (any network) and put it in any phone that can get SMS.\n" +
  "2. Don't install WhatsApp on that SIM.\n" +
  "3. Send the new number here, for example _0803 123 4567_.\n\n" +
  "Your own WhatsApp stays as it is, and new orders come to you there.";

const ASK_NUMBER = /^(new\s+)?(number|sim|connect|connect my number|my number)[.!]*$/i;

export interface NumberCollectorOptions {
  store: NumberQueueStore;
  log?: Pick<Console, "error">;
  /** Gets a message each time a number comes in (the yarnOga team). */
  alertWaId?: string;
  /** The server's https address, for a link to the queue in staff alerts. */
  publicUrl?: string;
}

export function createNumberCollector(opts: NumberCollectorOptions) {
  const log = opts.log ?? console;
  return {
    async opened(businessId: string): Promise<void> {
      // Most likely migration 0071 hasn't been run: the sign-up still finishes.
      await opts.store.open(businessId).catch((err) => log.error("Couldn't put the business on the number queue:", err));
    },

    /**
     * The owner's answer once signed up: their new SIM's number, or "number"
     * to see the steps again. Null for anything else, which the bot answers
     * as usual. A number can be changed until the business is registered.
     */
    async received(b: { businessId: string; businessName: string; ownerWaId: string }, text: string): Promise<Reply | null> {
      const request = await opts.store.get(b.businessId).catch((err) => {
        log.error("Couldn't read the number queue:", err);
        return null;
      });
      if (!request || request.status === "registered" || request.status === "live") return null;
      if (ASK_NUMBER.test(text.trim())) {
        return { text: request.number ? `We have *${localNumber(request.number)}* for your bot. Send a different number to change it.` : NEW_SIM_STEPS };
      }
      const number = phoneFromText(text);
      if (!number) return null;
      if (number === b.ownerWaId) {
        return {
          text: "That's the number you're chatting from. Your bot needs a new SIM that has never had WhatsApp on it, so you keep your own WhatsApp. Send the new SIM's number when you have it.",
        };
      }
      if (number === request.number) return { text: `We already have *${localNumber(number)}*. The yarnOga team will be in touch soon.` };

      const team = await opts.store.staff();
      const assigned = team.find((s) => s.id === request.assignedTo) ?? nextStaff(team, await opts.store.list());
      if (!(await opts.store.setNumber(b.businessId, number, assigned?.id ?? null))) {
        return { text: "That number is already connected to another business. Please check it and send it again." };
      }
      const notify: Notice[] = [];
      const job = { ...request, number, businessName: b.businessName, ownerWaId: b.ownerWaId };
      if (assigned) notify.push({ to: assigned.waId, text: staffAlert(job, opts.publicUrl) });
      if (opts.alertWaId && opts.alertWaId !== assigned?.waId) {
        notify.push({
          to: opts.alertWaId,
          text: `${staffAlert(job, opts.publicUrl)}\n\n${assigned ? `Assigned to ${assigned.name}.` : "Nobody is assigned: add staff on the queue page to share these out."}`,
        });
      }
      return {
        text:
          `Thanks! We've got *${localNumber(number)}*. Keep that SIM in a phone that can get SMS, and keep WhatsApp off it.\n\n` +
          "Someone from the yarnOga team will contact you soon to read the code Meta sends to that SIM. It takes about 10 minutes, and we'll message you here when your bot is live.",
        ...(notify.length ? { notify } : {}),
      };
    },
  };
}

/** The WhatsApp message to the person connecting a number. */
export function staffAlert(r: Pick<NumberRequest, "businessId" | "businessName" | "number" | "ownerWaId">, publicUrl?: string): string {
  return [
    `New number to connect for *${r.businessName}*: ${r.number ? localNumber(r.number) : "not sent yet"}.`,
    r.ownerWaId ? `Owner's WhatsApp: +${r.ownerWaId}` : "",
    publicUrl ? `Steps: ${publicUrl}/quote-setup/numbers/${r.businessId}` : "Steps: /quote-setup/numbers on the bot's website.",
  ]
    .filter(Boolean)
    .join("\n");
}

type RequestRow = {
  business_id: string;
  number: string | null;
  status: NumberStatus;
  assigned_to: string | null;
  phone_number_id: string | null;
  pin: string | null;
  note: string | null;
  number_at: string | null;
  live_at: string | null;
  created_at: string;
  quote_businesses: { name: string; owner_wa_id: string | null } | null;
};

const REQUEST_COLUMNS = "*, quote_businesses(name, owner_wa_id)";

function toRequest(r: RequestRow): NumberRequest {
  return {
    businessId: r.business_id,
    businessName: r.quote_businesses?.name ?? "Unknown business",
    ownerWaId: r.quote_businesses?.owner_wa_id ?? null,
    number: r.number,
    status: r.status,
    assignedTo: r.assigned_to,
    phoneNumberId: r.phone_number_id,
    pin: r.pin,
    note: r.note,
    numberAt: r.number_at ? new Date(r.number_at) : null,
    liveAt: r.live_at ? new Date(r.live_at) : null,
    createdAt: new Date(r.created_at),
  };
}

export function createSupabaseNumberQueue(db: SupabaseClient): NumberQueueStore {
  return {
    async list() {
      const { data, error } = await db
        .from("quote_number_requests")
        .select(REQUEST_COLUMNS)
        .order("number_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw new Error(`number queue failed: ${error.message}`);
      return (data as RequestRow[]).map(toRequest);
    },
    async get(businessId) {
      const { data, error } = await db.from("quote_number_requests").select(REQUEST_COLUMNS).eq("business_id", businessId).maybeSingle();
      if (error) throw new Error(`number request lookup failed: ${error.message}`);
      return data ? toRequest(data as RequestRow) : null;
    },
    async open(businessId) {
      const { error } = await db.from("quote_number_requests").upsert({ business_id: businessId }, { onConflict: "business_id", ignoreDuplicates: true });
      if (error) throw new Error(`open number request failed: ${error.message}`);
    },
    async setNumber(businessId, number, assignedTo) {
      const now = new Date().toISOString();
      const { error } = await db
        .from("quote_number_requests")
        .upsert(
          { business_id: businessId, number, status: "new", assigned_to: assignedTo, number_at: now, updated_at: now },
          { onConflict: "business_id" },
        );
      if (error?.code === "23505") return false;
      if (error) throw new Error(`save new number failed: ${error.message}`);
      return true;
    },
    async update(businessId, c) {
      const row = {
        updated_at: new Date().toISOString(),
        ...(c.status !== undefined ? { status: c.status } : {}),
        ...(c.assignedTo !== undefined ? { assigned_to: c.assignedTo } : {}),
        ...(c.phoneNumberId !== undefined ? { phone_number_id: c.phoneNumberId } : {}),
        ...(c.pin !== undefined ? { pin: c.pin } : {}),
        ...(c.note !== undefined ? { note: c.note } : {}),
        ...(c.liveAt !== undefined ? { live_at: c.liveAt?.toISOString() ?? null } : {}),
      };
      const { error } = await db.from("quote_number_requests").update(row).eq("business_id", businessId);
      if (error) throw new Error(`update number request failed: ${error.message}`);
    },
    async staff() {
      const { data, error } = await db.from("quote_connect_staff").select("id, name, wa_id").eq("active", true).order("created_at");
      if (error) throw new Error(`connect staff lookup failed: ${error.message}`);
      return (data as Array<{ id: string; name: string; wa_id: string }>).map((s) => ({ id: s.id, name: s.name, waId: s.wa_id }));
    },
    async addStaff(name, waId) {
      const { error } = await db.from("quote_connect_staff").insert({ name, wa_id: waId });
      if (error) throw new Error(`add connect staff failed: ${error.message}`);
    },
    async removeStaff(id) {
      const { error } = await db.from("quote_connect_staff").update({ active: false }).eq("id", id);
      if (error) throw new Error(`remove connect staff failed: ${error.message}`);
    },
  };
}

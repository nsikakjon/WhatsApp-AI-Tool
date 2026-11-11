import type { AdReferral, IncomingMessage, OwnerReply } from "./types.js";

// Meta's webhook body looks like:
// { object: "whatsapp_business_account",
//   entry: [{ changes: [{ field: "messages",
//     value: { contacts: [...], messages: [...], statuses: [...] } }] }] }
// One webhook can carry several messages, and many webhooks carry only
// "statuses" (sent/delivered/read receipts) with no messages at all.
export function extractMessages(payload: unknown): IncomingMessage[] {
  const result: IncomingMessage[] = [];
  const body = payload as WebhookBody;
  if (body?.object !== "whatsapp_business_account") return result;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value ?? {};
      const names = new Map<string, string | undefined>();
      for (const c of value.contacts ?? []) {
        for (const id of [c.wa_id, c.user_id]) if (id) names.set(id, c.profile?.name);
      }

      for (const msg of value.messages ?? []) {
        // A customer who hides their number behind a WhatsApp username comes
        // with only from_user_id, which we reply to like a phone number.
        const from = msg.from || msg.from_user_id;
        if (!msg.id || !from || !msg.type) continue;
        const media = msg.audio ?? msg.image ?? msg.document ?? msg.video;
        const referral = adReferral(msg.referral);
        result.push({
          waMessageId: msg.id,
          from,
          ...(msg.from_user_id ? { userId: msg.from_user_id } : {}),
          businessNumberId: value.metadata?.phone_number_id,
          contactName: names.get(from) ?? undefined,
          type: msg.type,
          // A tap on a list or button we sent comes back as the choice's id,
          // which products treat like typed text. A tap on a quick reply button
          // comes back as type "button": its payload is our id on a swipe card
          // ("I'd like Mugs", where the label is just "Order this"), and the
          // label itself on a template button we gave no payload (e.g. "Stop promotions").
          text:
            msg.type === "text"
              ? msg.text?.body
              : msg.type === "interactive"
                ? choiceId(msg.interactive)
                : msg.type === "button"
                  ? msg.button?.payload || msg.button?.text || undefined
                  : undefined,
          caption: media?.caption || undefined,
          mediaId: media?.id,
          location: pin(msg.location),
          sharedContacts: msg.contacts?.map((c) => ({
            name: c.name?.formatted_name || undefined,
            phone: c.phones?.find((p) => p.wa_id)?.wa_id ?? c.phones?.[0]?.phone,
          })),
          ...(referral ? { referral } : {}),
          timestamp: Number(msg.timestamp ?? 0),
          raw: msg,
        });
      }
    }
  }
  return result;
}

function adReferral(r: WebhookMessage["referral"]): AdReferral | undefined {
  if (!r?.source_id) return undefined;
  const text = (v: string | undefined) => v?.trim() || undefined;
  const out: AdReferral = { sourceType: text(r.source_type) ?? "ad", sourceId: r.source_id };
  for (const [key, value] of [
    ["sourceUrl", r.source_url],
    ["headline", r.headline],
    ["body", r.body],
    ["mediaType", r.media_type],
    ["ctwaClid", r.ctwa_clid],
  ] as const) {
    if (text(value)) out[key] = text(value);
  }
  return out;
}

/**
 * Which WhatsApp Business Account each of our numbers belongs to: every
 * webhook entry's id is the account, and its changes name the number.
 */
export function extractNumberAccounts(payload: unknown): Array<{ phoneNumberId: string; accountId: string }> {
  const body = payload as WebhookBody;
  if (body?.object !== "whatsapp_business_account") return [];
  return (body.entry ?? []).flatMap((entry) =>
    (entry.changes ?? []).flatMap((change) => {
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      return entry.id && phoneNumberId ? [{ phoneNumberId, accountId: entry.id }] : [];
    }),
  );
}

function pin(location: WebhookMessage["location"]): IncomingMessage["location"] {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!location || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return {
    latitude,
    longitude,
    ...(location.name ? { name: location.name } : {}),
    ...(location.address ? { address: location.address } : {}),
  };
}

// With WhatsApp coexistence (the owner keeps the WhatsApp Business app on the
// bot's number), Meta also sends a copy of every message the owner sends from
// the app, under field "smb_message_echoes":
// { field: "smb_message_echoes",
//   value: { metadata: {...}, message_echoes: [{ from, to, id, type, text, ... }] } }
// "from" is our number and "to" is the customer.
export function extractOwnerReplies(payload: unknown): OwnerReply[] {
  const result: OwnerReply[] = [];
  const body = payload as WebhookBody;
  if (body?.object !== "whatsapp_business_account") return result;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "smb_message_echoes") continue;
      const value = change.value ?? {};
      for (const msg of value.message_echoes ?? []) {
        if (!msg.id || !msg.to || !msg.type) continue;
        const media = msg.image ?? msg.document ?? msg.video;
        result.push({
          waMessageId: msg.id,
          to: msg.to,
          businessNumberId: value.metadata?.phone_number_id,
          type: msg.type,
          text: msg.type === "text" ? msg.text?.body : media?.caption || undefined,
          timestamp: Number(msg.timestamp ?? 0),
          raw: msg,
        });
      }
    }
  }
  return result;
}

/** A message of ours that WhatsApp accepted but then couldn't deliver. */
export interface FailedDelivery {
  waMessageId: string;
  to: string;
  businessNumberId?: string;
  /** WhatsApp's error code and title, e.g. 131047 "Re-engagement message". */
  code?: number;
  reason: string;
}

// Delivery receipts come as { field: "messages", value: { statuses: [{ id,
// status: "sent" | "delivered" | "read" | "failed", recipient_id, errors }] } }.
export function extractFailedDeliveries(payload: unknown): FailedDelivery[] {
  const result: FailedDelivery[] = [];
  const body = payload as WebhookBody;
  if (body?.object !== "whatsapp_business_account") return result;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      for (const status of change.value?.statuses ?? []) {
        if (status.status !== "failed" || !status.id) continue;
        const error = status.errors?.[0];
        result.push({
          waMessageId: status.id,
          to: status.recipient_id ?? "",
          businessNumberId: change.value?.metadata?.phone_number_id,
          code: error?.code,
          reason: error?.error_data?.details || error?.message || error?.title || "no reason given",
        });
      }
    }
  }
  return result;
}

function choiceId(interactive: InteractiveReply | undefined): string | undefined {
  return interactive?.list_reply?.id ?? interactive?.button_reply?.id ?? undefined;
}

interface InteractiveReply {
  type?: string;
  list_reply?: { id?: string; title?: string };
  button_reply?: { id?: string; title?: string };
}

interface WebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; user_id?: string; profile?: { name?: string } }>;
        messages?: Array<WebhookMessage>;
        message_echoes?: Array<WebhookMessage & { to?: string }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          recipient_id?: string;
          errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
        }>;
      };
    }>;
  }>;
}

interface WebhookMessage {
  id?: string;
  from?: string;
  from_user_id?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
  audio?: { id?: string; caption?: string };
  image?: { id?: string; caption?: string };
  document?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string };
  interactive?: InteractiveReply;
  button?: { text?: string; payload?: string };
  location?: { latitude?: number | string; longitude?: number | string; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string; wa_id?: string }> }>;
  referral?: {
    source_url?: string;
    source_id?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    ctwa_clid?: string;
  };
}

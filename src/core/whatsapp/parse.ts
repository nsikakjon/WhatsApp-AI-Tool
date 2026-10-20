import type { IncomingMessage, OwnerReply } from "./types.js";

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
      const names = new Map(
        (value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name] as const),
      );

      for (const msg of value.messages ?? []) {
        if (!msg.id || !msg.from || !msg.type) continue;
        const media = msg.audio ?? msg.image ?? msg.document ?? msg.video;
        result.push({
          waMessageId: msg.id,
          from: msg.from,
          businessNumberId: value.metadata?.phone_number_id,
          contactName: names.get(msg.from) ?? undefined,
          type: msg.type,
          // A tap on a list or button we sent comes back as the choice's id,
          // which products treat like typed text.
          text: msg.type === "text" ? msg.text?.body : msg.type === "interactive" ? choiceId(msg.interactive) : undefined,
          caption: media?.caption || undefined,
          mediaId: media?.id,
          location: pin(msg.location),
          timestamp: Number(msg.timestamp ?? 0),
          raw: msg,
        });
      }
    }
  }
  return result;
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
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: Array<WebhookMessage>;
        message_echoes?: Array<WebhookMessage & { to?: string }>;
      };
    }>;
  }>;
}

interface WebhookMessage {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
  audio?: { id?: string; caption?: string };
  image?: { id?: string; caption?: string };
  document?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string };
  interactive?: InteractiveReply;
  location?: { latitude?: number | string; longitude?: number | string; name?: string; address?: string };
}

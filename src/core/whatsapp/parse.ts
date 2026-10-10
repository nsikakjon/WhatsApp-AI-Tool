import type { IncomingMessage } from "./types.js";

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
        result.push({
          waMessageId: msg.id,
          from: msg.from,
          contactName: names.get(msg.from) ?? undefined,
          type: msg.type,
          text: msg.type === "text" ? msg.text?.body : undefined,
          mediaId: (msg.audio ?? msg.image ?? msg.document ?? msg.video)?.id,
          timestamp: Number(msg.timestamp ?? 0),
          raw: msg,
        });
      }
    }
  }
  return result;
}

interface WebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          timestamp?: string;
          text?: { body?: string };
          audio?: { id?: string };
          image?: { id?: string };
          document?: { id?: string };
          video?: { id?: string };
        }>;
      };
    }>;
  }>;
}

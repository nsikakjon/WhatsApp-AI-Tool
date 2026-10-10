import type { MessageStore } from "../db/store.js";
import type { WhatsAppClient } from "./client.js";

/**
 * Sends a text that isn't a direct reply (an alert or a scheduled report) and
 * saves it with the recipient's messages.
 */
export async function sendAndRecord(
  deps: { store: MessageStore; whatsapp: WhatsAppClient },
  to: string,
  text: string,
  fromNumberId?: string,
): Promise<void> {
  const contactId = await deps.store.upsertContact(to);
  const sent = await deps.whatsapp.sendText(to, text, fromNumberId);
  await deps.store.recordOutbound(contactId, { waMessageId: sent.waMessageId, type: "text", body: text, raw: sent.raw });
}

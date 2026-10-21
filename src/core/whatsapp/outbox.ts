import type { MessageStore } from "../db/store.js";
import type { Notice } from "../product.js";
import type { OutgoingButtons, OutgoingImage, OutgoingTemplate, WhatsAppClient } from "./client.js";

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
  await deps.store.recordOutbound(contactId, {
    waMessageId: sent.waMessageId,
    type: "text",
    body: text,
    raw: sent.raw,
    businessNumberId: fromNumberId,
  });
}

/** Sends a picture that isn't a direct reply (e.g. a scheduled flyer) and saves it with the recipient's messages. */
export async function sendImageAndRecord(
  deps: { store: MessageStore; whatsapp: WhatsAppClient },
  to: string,
  image: OutgoingImage,
  fromNumberId?: string,
): Promise<void> {
  const contactId = await deps.store.upsertContact(to);
  const sent = await deps.whatsapp.sendImage(to, image, fromNumberId);
  await deps.store.recordOutbound(contactId, {
    waMessageId: sent.waMessageId,
    type: "image",
    body: image.caption ?? "",
    raw: sent.raw,
    businessNumberId: fromNumberId,
  });
}

/** Sends a pre-approved template message and saves it with the recipient's messages. */
export async function sendTemplateAndRecord(
  deps: { store: MessageStore; whatsapp: WhatsAppClient },
  to: string,
  template: OutgoingTemplate,
  fromNumberId?: string,
): Promise<void> {
  const contactId = await deps.store.upsertContact(to);
  const sent = await deps.whatsapp.sendTemplate(to, template, fromNumberId);
  await deps.store.recordOutbound(contactId, {
    waMessageId: sent.waMessageId,
    type: "template",
    body: `[${template.name}] ${template.bodyParams.join(" | ")}`,
    raw: sent.raw,
    businessNumberId: fromNumberId,
  });
}

/** Sends a message with buttons that isn't a direct reply and saves it with the recipient's messages. */
export async function sendButtonsAndRecord(
  deps: { store: MessageStore; whatsapp: WhatsAppClient },
  to: string,
  buttons: OutgoingButtons,
  fromNumberId?: string,
): Promise<void> {
  const contactId = await deps.store.upsertContact(to);
  const sent = await deps.whatsapp.sendButtons(to, buttons, fromNumberId);
  await deps.store.recordOutbound(contactId, {
    waMessageId: sent.waMessageId,
    type: "interactive",
    body: buttons.body,
    raw: sent.raw,
    businessNumberId: fromNumberId,
  });
}

/**
 * Sends a notice to someone other than the sender. Someone who hasn't
 * messaged us in the last day gets the notice's template, when it has one.
 */
export async function sendNotice(
  deps: { store: MessageStore; whatsapp: WhatsAppClient },
  note: Notice,
  fromNumberId?: string,
): Promise<void> {
  if (note.template && !(await canMessageFreely(deps.store, note.to))) {
    await sendTemplateAndRecord(deps, note.to, note.template, fromNumberId);
    return;
  }
  if (note.text) await sendAndRecord(deps, note.to, note.text, fromNumberId);
  for (const image of note.images ?? []) await sendImageAndRecord(deps, note.to, image, fromNumberId);
  if (note.buttons) await sendButtonsAndRecord(deps, note.to, note.buttons, fromNumberId);
}

// WhatsApp allows ordinary messages for 24 hours after the person's last
// message. We stop an hour early to be safe.
const WINDOW_MS = 23 * 60 * 60 * 1000;

/**
 * True if we can still send this person ordinary messages (they messaged us
 * in the last day). Outside that, only template messages are delivered.
 */
export async function canMessageFreely(store: MessageStore, waId: string, now = new Date()): Promise<boolean> {
  const last = await store.lastInboundAt(waId);
  return last !== null && now.getTime() - last.getTime() < WINDOW_MS;
}

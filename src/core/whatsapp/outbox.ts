import type { MessageStore } from "../db/store.js";
import type { Notice } from "../product.js";
import type { OutgoingButtons, OutgoingImage, OutgoingLink, OutgoingTemplate, WhatsAppClient } from "./client.js";

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

/** Sends a text with a button that opens a web page, and saves it with the recipient's messages. */
export async function sendLinkAndRecord(
  deps: { store: MessageStore; whatsapp: WhatsAppClient },
  to: string,
  text: string,
  link: OutgoingLink,
  fromNumberId?: string,
): Promise<void> {
  const contactId = await deps.store.upsertContact(to);
  const sent = await deps.whatsapp.sendLink(to, text, link, fromNumberId);
  await deps.store.recordOutbound(contactId, {
    waMessageId: sent.waMessageId,
    type: "interactive",
    body: `${text}\n\n${link.label}: ${link.url}`,
    raw: sent.raw,
    businessNumberId: fromNumberId,
  });
}

export interface NoticeDeps {
  store: MessageStore;
  whatsapp: WhatsAppClient;
  /**
   * Approved template with one value ({{1}} = the notice's text), for notices
   * that have no template of their own, such as alerts to a business owner.
   */
  noticeTemplate?: { name: string; language: string };
  /** The number that sends when no other is named, so its 24 hours are the ones checked. */
  defaultNumberId?: string;
  /** Notices to these numbers are emailed too, since WhatsApp can hold them back (SIGNUP_ALERT_EMAIL). */
  emailCopy?: { waIds: string[]; send(text: string, link?: OutgoingLink): Promise<void> };
}

/**
 * Sends a notice to someone other than the sender. Someone who hasn't
 * messaged this number in the last day gets a template instead, since
 * WhatsApp accepts anything else but never delivers it: the notice's own
 * template, or else its text inside the general notice template, with the
 * link's address written out since that template has no button.
 */
export async function sendNotice(deps: NoticeDeps, note: Notice, fromNumberId?: string): Promise<void> {
  if (note.text && deps.emailCopy?.waIds.includes(note.to)) {
    await deps.emailCopy.send(note.text, note.link).catch((err) => console.warn(`Couldn't email a copy of the alert to ...${note.to.slice(-4)}:`, String(err)));
  }
  const spelledOut = note.link ? `${note.text}\n${note.link.label}: ${note.link.url}` : note.text;
  const template =
    note.template ?? (deps.noticeTemplate && note.text ? { ...deps.noticeTemplate, bodyParams: [asTemplateValue(spelledOut)] } : undefined);
  if (template && !(await canMessageFreely(deps.store, note.to, fromNumberId ?? deps.defaultNumberId))) {
    await sendTemplateAndRecord(deps, note.to, template, fromNumberId);
    return;
  }
  if (note.text && note.link) await sendLinkAndRecord(deps, note.to, note.text, note.link, fromNumberId);
  else if (note.text) await sendAndRecord(deps, note.to, note.text, fromNumberId);
  for (const image of note.images ?? []) await sendImageAndRecord(deps, note.to, image, fromNumberId);
  if (note.buttons) await sendButtonsAndRecord(deps, note.to, note.buttons, fromNumberId);
}

/** Template values can't hold line breaks or long runs of spaces, and stop at 1,024 characters. */
export function asTemplateValue(text: string): string {
  return text.trim().replace(/\s*\n+\s*/g, " · ").replace(/\s{2,}/g, " ").slice(0, 1000);
}

// WhatsApp allows ordinary messages for 24 hours after the person's last
// message. We stop an hour early to be safe.
const WINDOW_MS = 23 * 60 * 60 * 1000;

/**
 * True if we can still send this person ordinary messages (they messaged us
 * in the last day). Outside that, only template messages are delivered. The
 * day is counted per number: a message to the flyer line doesn't let the
 * quotes line write to them freely, so pass the number we'd send from.
 */
export async function canMessageFreely(
  store: MessageStore,
  waId: string,
  fromNumberId?: string,
  now = new Date(),
): Promise<boolean> {
  const last = await store.lastInboundAt(waId, fromNumberId);
  return last !== null && now.getTime() - last.getTime() < WINDOW_MS;
}

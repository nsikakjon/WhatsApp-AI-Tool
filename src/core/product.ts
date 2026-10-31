import type { OutgoingAudio, OutgoingButtons, OutgoingImage, OutgoingList, OutgoingTemplate } from "./whatsapp/client.js";
import type { IncomingMessage } from "./whatsapp/types.js";

// The contract every product module (echo, quote bot, site reporter, lead
// qualifier) implements. The core hands a product one incoming message and
// sends back whatever reply the product returns. Products never call
// WhatsApp or each other directly.
export interface Reply {
  /** The text reply. An empty string sends no text (e.g. when only pictures go back). */
  text: string;
  /** Pictures to send after the text, e.g. a finished flyer. */
  images?: OutgoingImage[];
  /** A voice note sent right after the text, e.g. the reply read aloud. */
  audio?: OutgoingAudio;
  /** Cards (a picture, text and buttons each), e.g. products from a catalogue, sent after the pictures. */
  cards?: OutgoingButtons[];
  /** A tappable list of choices, sent after the cards. */
  list?: OutgoingList;
  /** A message with up to 3 buttons, sent after the pictures. */
  buttons?: OutgoingButtons;
  /** A message with a "Send location" button, sent last. This is its text. */
  locationRequest?: string;
  /**
   * Extra messages to other people, e.g. a new-order alert to the business
   * owner, or a receipt to a customer. The core sends these after the main
   * reply.
   */
  notify?: Notice[];
  /** Hands this chat to the owner: the bot stays quiet in it for this many hours, as if the owner had replied from their phone. */
  handOver?: { hours: number };
}

/** A message to someone other than the sender: the text, then any pictures, then any buttons. */
export interface Notice {
  to: string;
  text: string;
  images?: OutgoingImage[];
  buttons?: OutgoingButtons;
  /**
   * Sent instead when the person hasn't messaged us in the last day, since
   * WhatsApp only delivers approved templates then.
   */
  template?: OutgoingTemplate;
}

/** One earlier message in the conversation, oldest first. */
export interface HistoryEntry {
  direction: "inbound" | "outbound";
  text: string;
}

/** What the core knows about the conversation, passed to the product with each message. */
export interface ProductContext {
  /** Our database id for the customer. */
  contactId: string;
  /** Recent text messages with this customer, oldest first, not including this one. */
  history: HistoryEntry[];
  /** Downloads a file the sender attached (photo, voice note, ...) by its media id. */
  downloadMedia(mediaId: string): Promise<{ data: Blob; mimeType: string }>;
  /**
   * Sends another reply later, for work that takes too long to finish before
   * answering (e.g. importing a whole spreadsheet). Errors are logged, not thrown.
   */
  sendLater(reply: Reply): Promise<void>;
  /** True if this person messaged us in the last day, so WhatsApp will deliver an ordinary message to them. */
  canMessageFreely(waId: string): Promise<boolean>;
}

export interface Product {
  name: string;
  handle(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null>;
}

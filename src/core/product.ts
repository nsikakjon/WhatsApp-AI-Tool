import type { OutgoingImage, OutgoingList } from "./whatsapp/client.js";
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
  /** A tappable list of choices, sent after the pictures. */
  list?: OutgoingList;
  /**
   * Extra messages to other people, e.g. a new-order alert to the business
   * owner. The core sends these after the main reply.
   */
  notify?: Array<{ to: string; text: string }>;
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
}

export interface Product {
  name: string;
  handle(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null>;
}

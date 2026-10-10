import type { IncomingMessage } from "./whatsapp/types.js";

// The contract every product module (echo, quote bot, site reporter, lead
// qualifier) implements. The core hands a product one incoming message and
// sends back whatever reply the product returns. Products never call
// WhatsApp or each other directly.
export interface Reply {
  text: string;
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
}

export interface Product {
  name: string;
  handle(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null>;
}

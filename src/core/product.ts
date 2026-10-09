import type { IncomingMessage } from "./whatsapp/types.js";

// The contract every product module (echo, quote bot, site reporter, lead
// qualifier) implements. The core hands a product one incoming message and
// sends back whatever reply the product returns. Products never call
// WhatsApp or each other directly.
export interface Reply {
  text: string;
}

export interface Product {
  name: string;
  handle(msg: IncomingMessage): Promise<Reply | null>;
}

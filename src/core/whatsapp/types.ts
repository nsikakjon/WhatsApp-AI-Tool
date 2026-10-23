// The shape of a single incoming WhatsApp message after we've pulled it out of
// Meta's nested webhook payload. Products only ever see this, never the raw payload.
export interface IncomingMessage {
  /** WhatsApp's unique ID for this message (used to skip duplicates). */
  waMessageId: string;
  /**
   * Sender's WhatsApp ID: their phone number, digits only, e.g. 2348012345678.
   * When they hide their number behind a WhatsApp username, this is their
   * business-scoped user ID instead (see ids.ts); replies still reach them.
   */
  from: string;
  /** Meta's business-scoped user ID for the sender, when Meta sent one. */
  userId?: string;
  /**
   * Meta's "Phone number ID" of OUR number that received the message. Lets one
   * server run several numbers, each answered by a different product.
   */
  businessNumberId?: string;
  /** Sender's WhatsApp profile name, if Meta included it. */
  contactName?: string;
  /** text, image, audio, document, location, etc. */
  type: string;
  /**
   * The text: what was typed for text messages, or what was said for voice
   * notes once the core has transcribed them.
   */
  text?: string;
  /** The caption typed under a photo, video or document, if any. */
  caption?: string;
  /** True when `text` came from transcribing a voice note. */
  transcribed?: boolean;
  /** WhatsApp's id for an attached file (voice note, image, ...), used to download it. */
  mediaId?: string;
  /**
   * A location pin the sender dropped (attach > Location > Send your current
   * location, or a place they picked). WhatsApp only passes one fixed pin to
   * bots: live location arrives as type "unsupported" with no coordinates.
   */
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  /** Unix time (seconds) WhatsApp says the message was sent. */
  timestamp: number;
  /** The original message object from Meta, kept for logging and storage. */
  raw: unknown;
}

/**
 * A message the business owner sent from the WhatsApp Business app on a number
 * that also runs the bot (WhatsApp "coexistence"). Meta copies these to us as
 * "smb_message_echoes" so the bot knows a person has stepped in.
 */
export interface OwnerReply {
  /** WhatsApp's unique ID for this message (used to skip duplicates). */
  waMessageId: string;
  /** The customer the owner wrote to: their WhatsApp ID, digits only. */
  to: string;
  /** Meta's "Phone number ID" of OUR number the owner wrote from. */
  businessNumberId?: string;
  /** text, image, audio, document, etc. */
  type: string;
  /** What the owner typed, for text messages (or the caption on a photo). */
  text?: string;
  /** Unix time (seconds) WhatsApp says the message was sent. */
  timestamp: number;
  /** The original message object from Meta, kept for storage. */
  raw: unknown;
}

// The shape of a single incoming WhatsApp message after we've pulled it out of
// Meta's nested webhook payload. Products only ever see this, never the raw payload.
export interface IncomingMessage {
  /** WhatsApp's unique ID for this message (used to skip duplicates). */
  waMessageId: string;
  /** Sender's WhatsApp ID: their phone number, digits only, e.g. 2348012345678. */
  from: string;
  /** Sender's WhatsApp profile name, if Meta included it. */
  contactName?: string;
  /** text, image, audio, document, location, etc. */
  type: string;
  /**
   * The text: what was typed for text messages, or what was said for voice
   * notes once the core has transcribed them.
   */
  text?: string;
  /** True when `text` came from transcribing a voice note. */
  transcribed?: boolean;
  /** WhatsApp's id for an attached file (voice note, image, ...), used to download it. */
  mediaId?: string;
  /** Unix time (seconds) WhatsApp says the message was sent. */
  timestamp: number;
  /** The original message object from Meta, kept for logging and storage. */
  raw: unknown;
}

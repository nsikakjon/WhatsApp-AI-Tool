import { Hono } from "hono";
import type { MessageStore } from "../db/store.js";
import type { Transcriber } from "../voice/transcribe.js";
import type { Product } from "../product.js";
import type { WhatsAppClient } from "./client.js";
import { extractMessages } from "./parse.js";
import { isValidSignature } from "./signature.js";
import type { IncomingMessage } from "./types.js";

export interface WebhookDeps {
  verifyToken: string;
  appSecret: string;
  store: MessageStore;
  whatsapp: WhatsAppClient;
  /** Turns voice notes into text. Optional: without it, voice notes reach products with no text. */
  transcriber?: Transcriber;
  /** Picks which product handles a message. */
  route: (msg: IncomingMessage) => Product;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export function createWhatsAppWebhook(deps: WebhookDeps) {
  const log = deps.log ?? console;
  const app = new Hono();

  // GET: Meta calls this once when you save the webhook URL in the dashboard,
  // to check you own it. We must echo back hub.challenge if the token matches.
  app.get("/", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");

    if (mode === "subscribe" && token === deps.verifyToken && challenge) {
      log.info("WhatsApp webhook verified");
      return c.text(challenge, 200);
    }
    log.warn("WhatsApp webhook verification failed");
    return c.text("Forbidden", 403);
  });

  // POST: Meta calls this for every incoming message and delivery receipt.
  app.post("/", async (c) => {
    // Read the raw text first: the signature is computed over the exact bytes.
    const rawBody = await c.req.text();
    if (!isValidSignature(rawBody, c.req.header("x-hub-signature-256"), deps.appSecret)) {
      log.warn("Rejected WhatsApp webhook with invalid signature");
      return c.text("Invalid signature", 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.text("Invalid JSON", 400);
    }

    for (const msg of extractMessages(payload)) {
      try {
        await handleMessage(deps, msg, log);
      } catch (err) {
        // Log and carry on. We still answer 200 so Meta doesn't keep retrying
        // a message that will fail the same way every time.
        log.error(`Failed to handle message ${msg.waMessageId}:`, err);
      }
    }

    return c.text("OK", 200);
  });

  return app;
}

async function handleMessage(
  deps: WebhookDeps,
  msg: IncomingMessage,
  log: Pick<Console, "info" | "warn" | "error">,
) {
  const contactId = await deps.store.upsertContact(msg.from, msg.contactName);

  // Saving the message doubles as the duplicate check: WhatsApp message IDs are
  // unique in the database, so a retried webhook is spotted here.
  if ((await deps.store.recordInbound(contactId, msg)) === "duplicate") {
    log.info(`Skipping duplicate message ${msg.waMessageId}`);
    return;
  }

  if (msg.type === "audio" && msg.mediaId && deps.transcriber) {
    msg = await transcribeVoiceNote(deps, msg, log);
  }

  const history = await deps.store.recentHistory(contactId, HISTORY_LIMIT, msg.waMessageId);
  const product = deps.route(msg);
  log.info(`Message ${msg.waMessageId} (${msg.type}) from ${mask(msg.from)} -> ${product.name}`);
  const reply = await product.handle(msg, { contactId, history });
  if (!reply) return;

  const sent = await deps.whatsapp.sendText(msg.from, reply.text);
  log.info(`Replied to ${mask(msg.from)}`);
  await deps.store.recordOutbound(contactId, {
    waMessageId: sent.waMessageId,
    type: "text",
    body: reply.text,
    raw: sent.raw,
  });

  // Alerts to other people (e.g. the business owner). A failed alert is logged
  // but doesn't undo the customer's reply, which has already gone out.
  for (const note of reply.notify ?? []) {
    try {
      const noteContactId = await deps.store.upsertContact(note.to);
      const noteSent = await deps.whatsapp.sendText(note.to, note.text);
      await deps.store.recordOutbound(noteContactId, {
        waMessageId: noteSent.waMessageId,
        type: "text",
        body: note.text,
        raw: noteSent.raw,
      });
    } catch (err) {
      log.error(`Failed to send notification to ${note.to}:`, err);
    }
  }
}

/**
 * Downloads a voice note and fills in `text` with what was said. If anything
 * fails, the message is passed on without text and the product asks the
 * customer to type instead.
 */
async function transcribeVoiceNote(
  deps: WebhookDeps,
  msg: IncomingMessage,
  log: Pick<Console, "info" | "warn" | "error">,
): Promise<IncomingMessage> {
  try {
    const audio = await deps.whatsapp.downloadMedia(msg.mediaId!);
    const text = await deps.transcriber!.transcribe(audio.data, audio.mimeType);
    if (!text) return msg;
    await deps.store.setInboundText(msg.waMessageId, text);
    log.info(`Transcribed voice note ${msg.waMessageId} (${text.length} characters)`);
    return { ...msg, text, transcribed: true };
  } catch (err) {
    log.error(`Failed to transcribe voice note ${msg.waMessageId}:`, err);
    return msg;
  }
}

/** Hides most of a phone number in logs, e.g. 2348012345678 -> ...5678. */
function mask(waId: string): string {
  return `...${waId.slice(-4)}`;
}

// How many earlier messages a product sees, so it can follow the conversation.
const HISTORY_LIMIT = 10;

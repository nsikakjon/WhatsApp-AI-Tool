import { Hono } from "hono";
import type { MessageStore } from "../db/store.js";
import type { Transcriber } from "../voice/transcribe.js";
import type { Product, Reply } from "../product.js";
import type { WhatsAppClient } from "./client.js";
import { sendAndRecord, sendImageAndRecord } from "./outbox.js";
import { extractMessages, extractOwnerReplies } from "./parse.js";
import { isValidSignature } from "./signature.js";
import type { IncomingMessage, OwnerReply } from "./types.js";

export interface WebhookDeps {
  verifyToken: string;
  appSecret: string;
  store: MessageStore;
  whatsapp: WhatsAppClient;
  /** Turns voice notes into text. Optional: without it, voice notes reach products with no text. */
  transcriber?: Transcriber;
  /** Picks which product handles a message. */
  route: (msg: IncomingMessage) => Product;
  /**
   * WhatsApp coexistence: when the owner replies to a customer from the
   * WhatsApp Business app, the bot stays quiet in that chat for this many
   * minutes (counted from the owner's latest reply). 0 or unset: off.
   */
  ownerReplyPauseMinutes?: number;
  /** The current time. Tests replace it; the server uses the real clock. */
  now?: () => Date;
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

    // Owner replies first, so a customer message in the same batch already
    // sees the chat as paused.
    for (const reply of extractOwnerReplies(payload)) {
      try {
        await handleOwnerReply(deps, reply, log);
      } catch (err) {
        log.error(`Failed to handle owner reply ${reply.waMessageId}:`, err);
      }
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

  // The owner is chatting with this customer from the WhatsApp Business app:
  // the message is saved (above) but the bot stays out of it.
  if (await isPaused(deps, msg, log)) {
    log.info(`Message ${msg.waMessageId} from ${mask(msg.from)}: owner is handling this chat, bot stays quiet`);
    return;
  }

  if (msg.type === "audio" && msg.mediaId && deps.transcriber) {
    msg = await transcribeVoiceNote(deps, msg, log);
  }

  const history = await deps.store.recentHistory(contactId, HISTORY_LIMIT, msg.waMessageId);
  const product = deps.route(msg);
  log.info(`Message ${msg.waMessageId} (${msg.type}) from ${mask(msg.from)} -> ${product.name}`);
  // Answer from the same number the person messaged.
  const fromNumber = msg.businessNumberId;
  const reply = await product.handle(msg, {
    contactId,
    history,
    downloadMedia: (mediaId) => deps.whatsapp.downloadMedia(mediaId),
    sendLater: async (later) => {
      try {
        await sendReply(deps, msg.from, contactId, later, fromNumber, log);
      } catch (err) {
        log.error(`Failed to send a follow-up to ${mask(msg.from)}:`, err);
      }
    },
  });
  if (!reply) return;
  await sendReply(deps, msg.from, contactId, reply, fromNumber, log);
}

/**
 * The owner sent a message from the WhatsApp Business app on the bot's number.
 * Save it (so the bot has the full conversation later) and pause the bot in
 * that chat. Each owner message pushes the pause further out.
 */
async function handleOwnerReply(
  deps: WebhookDeps,
  reply: OwnerReply,
  log: Pick<Console, "info" | "warn" | "error">,
) {
  const minutes = deps.ownerReplyPauseMinutes ?? 0;
  if (minutes <= 0) return;

  const contactId = await deps.store.upsertContact(reply.to);
  if ((await deps.store.recordOwnerReply(contactId, reply)) === "duplicate") {
    log.info(`Skipping duplicate owner reply ${reply.waMessageId}`);
    return;
  }
  const until = new Date(now(deps).getTime() + minutes * 60_000);
  await deps.store.pauseChat(reply.businessNumberId ?? "", reply.to, until);
  log.info(`Owner replied to ${mask(reply.to)}: bot paused in that chat for ${minutes} minutes`);
}

async function isPaused(
  deps: WebhookDeps,
  msg: IncomingMessage,
  log: Pick<Console, "info" | "warn" | "error">,
): Promise<boolean> {
  if (!deps.ownerReplyPauseMinutes || deps.ownerReplyPauseMinutes <= 0) return false;
  try {
    const until = await deps.store.chatPausedUntil(msg.businessNumberId ?? "", msg.from);
    return until !== null && until > now(deps);
  } catch (err) {
    // E.g. the chat_pauses table hasn't been created yet. Better to answer
    // than to leave every customer without a reply.
    log.error("Could not check whether the owner is handling this chat:", err);
    return false;
  }
}

function now(deps: WebhookDeps): Date {
  return deps.now ? deps.now() : new Date();
}

/** Sends a product's reply: its text, then its pictures, then any list of choices, then any alerts to other people. */
async function sendReply(
  deps: WebhookDeps,
  to: string,
  contactId: string,
  reply: Reply,
  fromNumber: string | undefined,
  log: Pick<Console, "info" | "warn" | "error">,
) {
  if (reply.text) {
    const sent = await deps.whatsapp.sendText(to, reply.text, fromNumber);
    log.info(`Replied to ${mask(to)}`);
    await deps.store.recordOutbound(contactId, {
      waMessageId: sent.waMessageId,
      type: "text",
      body: reply.text,
      raw: sent.raw,
    });
  }
  for (const image of reply.images ?? []) {
    await sendImageAndRecord(deps, to, image, fromNumber);
    log.info(`Sent a picture to ${mask(to)}`);
  }
  if (reply.list) {
    const sent = await deps.whatsapp.sendList(to, reply.list, fromNumber);
    await deps.store.recordOutbound(contactId, {
      waMessageId: sent.waMessageId,
      type: "interactive",
      body: reply.list.body,
      raw: sent.raw,
    });
  }

  // Alerts to other people (e.g. the business owner). A failed alert is logged
  // but doesn't undo the customer's reply, which has already gone out.
  for (const note of reply.notify ?? []) {
    try {
      if (note.text) await sendAndRecord(deps, note.to, note.text, fromNumber);
      for (const image of note.images ?? []) await sendImageAndRecord(deps, note.to, image, fromNumber);
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

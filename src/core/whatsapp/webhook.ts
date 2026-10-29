import { guessLanguage } from "../i18n.js";
import { Hono } from "hono";
import { isPauseActive, type MessageStore } from "../db/store.js";
import type { Transcriber } from "../voice/transcribe.js";
import type { Product, Reply } from "../product.js";
import type { OutgoingButtons, WhatsAppClient } from "./client.js";
import { canMessageFreely, sendImageAndRecord, sendNotice } from "./outbox.js";
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
  /**
   * What a customer is sent when their message can't be answered (the bot
   * crashed or its reply couldn't be sent). Default: FALLBACK_TEXT.
   */
  fallbackText?: string;
  /** Waits between tries of a WhatsApp call or a reply that failed for a passing reason. Default 1s then 3s. */
  retryDelaysMs?: number[];
  /** The current time. Tests replace it; the server uses the real clock. */
  now?: () => Date;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export const FALLBACK_TEXT =
  "Sorry, something went wrong on our side and I couldn't finish answering. Please send your message again in a minute. If it keeps happening, the team has been alerted and will get back to you.";
export const FALLBACK_TEXT_FR =
  "Désolé, un problème est survenu de notre côté et je n'ai pas pu terminer ma réponse. Merci de renvoyer votre message dans une minute. Si cela continue, l'équipe a été prévenue et vous recontactera.";

export function createWhatsAppWebhook(webhookDeps: WebhookDeps) {
  const log = webhookDeps.log ?? console;
  const delays = webhookDeps.retryDelaysMs ?? [1000, 3000];
  // Every WhatsApp call is tried again when it fails for a passing reason
  // (WhatsApp busy, a dropped connection), so a hiccup doesn't lose a reply.
  const deps: WebhookDeps = { ...webhookDeps, whatsapp: retryingClient(webhookDeps.whatsapp, delays, log) };
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
  // Someone we know by phone number who now hides it behind a username:
  // carry on under the number we have, so their orders and settings follow them.
  if (msg.userId && msg.from === msg.userId) {
    const known = await deps.store.waIdForUser(msg.userId);
    if (known) msg = { ...msg, from: known };
  }
  const contactId = await deps.store.upsertContact(msg.from, msg.contactName, msg.userId);

  // Saving the message doubles as the duplicate check: WhatsApp message IDs are
  // unique in the database, so a retried webhook is spotted here.
  if ((await deps.store.recordInbound(contactId, msg)) === "duplicate") {
    log.info(`Skipping duplicate message ${msg.waMessageId}`);
    return;
  }

  // The owner is chatting with this customer from the WhatsApp Business app:
  // the message is saved (above) but the bot stays out of it.
  if (await isPaused(deps, contactId, msg, log)) {
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
  const ctx = {
    contactId,
    history,
    downloadMedia: (mediaId: string) => deps.whatsapp.downloadMedia(mediaId, fromNumber),
    sendLater: async (later: Reply) => {
      try {
        await sendReply(deps, msg.from, contactId, later, fromNumber, log);
      } catch (err) {
        log.error(`Failed to send a follow-up to ${mask(msg.from)}:`, err);
      }
    },
    canMessageFreely: (waId: string) => canMessageFreely(deps.store, waId, now(deps)),
  };

  // The bot itself failed (e.g. the AI didn't answer in time): try once more
  // when the reason looks passing, otherwise tell the customer instead of
  // leaving them waiting. The error is logged, which alerts Jay.
  let reply: Reply | null;
  try {
    reply = await product.handle(msg, ctx);
  } catch (err) {
    const delay = deps.retryDelaysMs?.[0] ?? 1000;
    if (!isTransient(err)) {
      log.error(`The ${product.name} bot failed on message ${msg.waMessageId}:`, err);
      await sendFallback(deps, msg.from, contactId, fromNumber, log, msg.text);
      return;
    }
    log.warn(`The ${product.name} bot failed on message ${msg.waMessageId}, trying again: ${String(err)}`);
    await sleep(delay);
    try {
      reply = await product.handle(msg, ctx);
    } catch (again) {
      log.error(`The ${product.name} bot failed twice on message ${msg.waMessageId}:`, again);
      await sendFallback(deps, msg.from, contactId, fromNumber, log, msg.text);
      return;
    }
  }
  if (!reply) return;
  try {
    await sendReply(deps, msg.from, contactId, reply, fromNumber, log);
  } catch (err) {
    // Part of the reply may have gone out; the customer still needs to know
    // the rest didn't. (Each WhatsApp call was already tried again.)
    log.error(`Failed to send the reply to message ${msg.waMessageId}:`, err);
    await sendFallback(deps, msg.from, contactId, fromNumber, log, msg.text);
  }
}

async function sendFallback(
  deps: WebhookDeps,
  to: string,
  contactId: string,
  fromNumber: string | undefined,
  log: Pick<Console, "info" | "warn" | "error">,
  said?: string,
) {
  // In French when the customer wrote in French.
  const text = deps.fallbackText ?? (guessLanguage(said) === "fr" ? FALLBACK_TEXT_FR : FALLBACK_TEXT);
  try {
    await sendReply(deps, to, contactId, { text }, fromNumber, log);
  } catch (err) {
    log.error(`Could not send the fallback reply to ${mask(to)} either:`, err);
  }
}

/**
 * True for failures that may well work a moment later: WhatsApp or the AI
 * busy or down for a moment (429, 5xx, "overloaded"), a timeout, or a
 * dropped connection. Not for mistakes that would fail the same way again.
 */
export function isTransient(err: unknown): boolean {
  const e = err as { status?: number; code?: string; name?: string; message?: string; cause?: unknown } | null;
  if (!e) return false;
  if (typeof e.status === "number") return e.status === 408 || e.status === 429 || e.status >= 500;
  const text = `${e.name ?? ""} ${e.code ?? ""} ${e.message ?? ""}`;
  if (/\((408|429|5\d\d)\)/.test(text)) return true;
  if (/overloaded|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(text)) return true;
  return e.cause ? isTransient(e.cause) : false;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** The same WhatsApp client, with each call tried again (after `delays`) when it fails for a passing reason. */
export function retryingClient(client: WhatsAppClient, delays: number[], log: Pick<Console, "warn">): WhatsAppClient {
  const wrapped = {} as Record<string, unknown>;
  for (const key of Object.keys(client) as Array<keyof WhatsAppClient>) {
    const fn = client[key] as unknown as (...args: unknown[]) => Promise<unknown>;
    if (typeof fn !== "function") {
      wrapped[key] = fn;
      continue;
    }
    wrapped[key] = async (...args: unknown[]) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fn.apply(client, args);
        } catch (err) {
          if (attempt >= delays.length || !isTransient(err)) throw err;
          log.warn(`WhatsApp ${String(key)} failed (${String(err)}), trying again`);
          await sleep(delays[attempt]!);
        }
      }
    };
  }
  return wrapped as unknown as WhatsAppClient;
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
  const numberId = reply.businessNumberId ?? "";
  // A chat someone took over with no end time (e.g. from the inbox) stays that way.
  const current = await deps.store.botPause(contactId, numberId);
  if (current && current.until === null) return;
  const until = new Date(now(deps).getTime() + minutes * 60_000);
  await deps.store.pauseBot(contactId, numberId, until, "phone");
  log.info(`Owner replied to ${mask(reply.to)}: bot paused in that chat for ${minutes} minutes`);
}

async function isPaused(
  deps: WebhookDeps,
  contactId: string,
  msg: IncomingMessage,
  log: Pick<Console, "info" | "warn" | "error">,
): Promise<boolean> {
  try {
    return isPauseActive(await deps.store.botPause(contactId, msg.businessNumberId ?? ""), now(deps));
  } catch (err) {
    // E.g. the bot_pauses table hasn't been created yet. Better to answer
    // than to leave every customer without a reply.
    log.error("Could not check whether the owner is handling this chat:", err);
    return false;
  }
}

function now(deps: WebhookDeps): Date {
  return deps.now ? deps.now() : new Date();
}

/** Sends a product's reply: its text, its pictures, any cards, any list or buttons, any location request, then any alerts to other people. */
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
      businessNumberId: fromNumber,
    });
  }
  if (reply.audio && deps.whatsapp.sendAudio) {
    // A voice note is extra: if it can't go, the text has already been sent.
    try {
      const sent = await deps.whatsapp.sendAudio(to, reply.audio, fromNumber);
      await deps.store.recordOutbound(contactId, { waMessageId: sent.waMessageId, type: "audio", body: "[voice note]", raw: sent.raw, businessNumberId: fromNumber });
      log.info(`Sent a voice note to ${mask(to)}`);
    } catch (err) {
      log.error(`Couldn't send the voice note to ${mask(to)}:`, err);
    }
  }
  for (const image of reply.images ?? []) {
    await sendImageAndRecord(deps, to, image, fromNumber);
    log.info(`Sent a picture to ${mask(to)}`);
  }
  const sendButtons = async (buttons: OutgoingButtons) => {
    const sent = await deps.whatsapp.sendButtons(to, buttons, fromNumber);
    await deps.store.recordOutbound(contactId, {
      waMessageId: sent.waMessageId,
      type: "interactive",
      body: buttons.body,
      raw: sent.raw,
      businessNumberId: fromNumber,
    });
  };
  for (const card of reply.cards ?? []) await sendButtons(card);
  if (reply.list) {
    const sent = await deps.whatsapp.sendList(to, reply.list, fromNumber);
    await deps.store.recordOutbound(contactId, {
      waMessageId: sent.waMessageId,
      type: "interactive",
      body: reply.list.body,
      raw: sent.raw,
      businessNumberId: fromNumber,
    });
  }
  if (reply.buttons) await sendButtons(reply.buttons);
  if (reply.locationRequest) {
    const sent = await deps.whatsapp.sendLocationRequest(to, reply.locationRequest, fromNumber);
    await deps.store.recordOutbound(contactId, {
      waMessageId: sent.waMessageId,
      type: "interactive",
      body: reply.locationRequest,
      raw: sent.raw,
      businessNumberId: fromNumber,
    });
  }

  // Alerts to other people (e.g. the business owner). A failed alert is logged
  // but doesn't undo the customer's reply, which has already gone out.
  for (const note of reply.notify ?? []) {
    try {
      await sendNotice(deps, note, fromNumber);
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
    const audio = await deps.whatsapp.downloadMedia(msg.mediaId!, msg.businessNumberId);
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

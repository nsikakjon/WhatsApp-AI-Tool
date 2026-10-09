import { Hono } from "hono";
import type { MessageStore } from "../db/store.js";
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
  /** Picks which product handles a message. Phase 0 always returns echo. */
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

  const product = deps.route(msg);
  const reply = await product.handle(msg);
  if (!reply) return;

  const sent = await deps.whatsapp.sendText(msg.from, reply.text);
  await deps.store.recordOutbound(contactId, {
    waMessageId: sent.waMessageId,
    type: "text",
    body: reply.text,
    raw: sent.raw,
  });
}

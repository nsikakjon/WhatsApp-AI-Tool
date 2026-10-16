import { Hono } from "hono";
import { isValidSignature } from "../core/whatsapp/signature.js";
import type { InstagramClient } from "./client.js";
import { privateReplyText, publicReplyText } from "./messages.js";
import { extractComments, type IncomingComment } from "./parse.js";
import type { InstagramCommentStore } from "./store.js";

// Instagram comment auto-reply for the real estate leads. When someone
// comments on one of the account's posts (e.g. "How much is this?"), the bot
// sends them a private message with a link to the leads WhatsApp number, then
// answers the comment in public so others see it was handled. This lives
// apart from the WhatsApp bots and is only switched on with INSTAGRAM_AUTOREPLY.

export interface InstagramWebhookDeps {
  verifyToken: string;
  appSecret: string;
  accountId: string;
  businessName: string;
  whatsappNumber: string;
  store: InstagramCommentStore;
  instagram: InstagramClient;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export function createInstagramWebhook(deps: InstagramWebhookDeps) {
  const log = deps.log ?? console;
  const app = new Hono();

  // GET: Meta checks the webhook URL is ours when it is saved in the dashboard.
  app.get("/", (c) => {
    const challenge = c.req.query("hub.challenge");
    if (c.req.query("hub.mode") === "subscribe" && c.req.query("hub.verify_token") === deps.verifyToken && challenge) {
      log.info("Instagram webhook verified");
      return c.text(challenge, 200);
    }
    log.warn("Instagram webhook verification failed");
    return c.text("Forbidden", 403);
  });

  // POST: Meta calls this for every new comment.
  app.post("/", async (c) => {
    const rawBody = await c.req.text();
    if (!isValidSignature(rawBody, c.req.header("x-hub-signature-256"), deps.appSecret)) {
      log.warn("Rejected Instagram webhook with invalid signature");
      return c.text("Invalid signature", 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.text("Invalid JSON", 400);
    }

    let failed = false;
    for (const comment of extractComments(payload, deps.accountId)) {
      try {
        await handleComment(deps, comment, log);
      } catch (err) {
        failed = true;
        log.error(`Failed to answer Instagram comment ${comment.commentId}:`, err);
        await deps.store.markFailed(comment.commentId, err instanceof Error ? err.message : String(err)).catch(() => {});
      }
    }

    // A failure answers 500 so Meta sends the webhook again later; comments
    // that already went through are skipped then.
    return failed ? c.text("Retry later", 500) : c.text("OK", 200);
  });

  return app;
}

async function handleComment(
  deps: InstagramWebhookDeps,
  comment: IncomingComment,
  log: Pick<Console, "info" | "warn" | "error">,
) {
  const progress = await deps.store.claim(comment);
  if (!progress) {
    log.info(`Skipping Instagram comment ${comment.commentId}: already handled`);
    return;
  }

  // The private message first: it's the one that brings the lead to WhatsApp.
  if (!progress.privateReplySent) {
    await deps.instagram.sendPrivateReply(
      comment.commentId,
      privateReplyText({ username: comment.username, businessName: deps.businessName, whatsappNumber: deps.whatsappNumber }),
    );
    await deps.store.markPrivateReplySent(comment.commentId);
  }
  if (!progress.publicReplySent) {
    await deps.instagram.replyToComment(comment.commentId, publicReplyText(comment.username));
    await deps.store.markPublicReplySent(comment.commentId);
  }
  await deps.store.markDone(comment.commentId);
  log.info(`Answered Instagram comment ${comment.commentId}`);
}

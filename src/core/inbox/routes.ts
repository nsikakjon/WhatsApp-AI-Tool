import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { MessageStore } from "../db/store.js";
import type { WhatsAppClient } from "../whatsapp/client.js";
import { canMessageFreely } from "../whatsapp/outbox.js";
import { SESSION_DAYS, cookieSecret, createLoginThrottle, passwordMatches } from "./auth.js";
import type { InboxStore } from "./store.js";
import { chatListPage, chatPage, loginPage, type NumberLabel } from "./views.js";

/**
 * Stops and restarts the bot on one chat. Shared with "the bot steps back
 * when the owner replies from their phone", so both use the same pause.
 */
export interface BotPauses {
  isPaused(contactId: string, businessNumberId: string): Promise<boolean>;
  /** Pauses the bot on this chat until handed back. */
  pause(contactId: string, businessNumberId: string): Promise<void>;
  resume(contactId: string, businessNumberId: string): Promise<void>;
}

export interface InboxDeps {
  /** The shared staff password (INBOX_PASSWORD). */
  password: string;
  /** Meta app secret, mixed into the login cookie's signature. */
  appSecret: string;
  inbox: InboxStore;
  /** Used to save staff replies and check WhatsApp's 24-hour reply window. */
  messages: MessageStore;
  whatsapp: WhatsAppClient;
  /** Our WhatsApp numbers, main number (WHATSAPP_PHONE_NUMBER_ID) first. */
  numbers: NumberLabel[];
  /** Without it, the inbox can read and reply but has no take over / hand back. */
  pauses?: BotPauses;
  log?: Pick<Console, "info" | "warn" | "error">;
}

const COOKIE = "inbox_session";
const CHATS_SHOWN = 100;
const MESSAGES_SHOWN = 200;
const MAX_REPLY = 4096;

const ERRORS: Record<string, string> = {
  empty: "Type a message before sending.",
  window: "WhatsApp won't deliver this: the customer last wrote more than a day ago.",
  send: "Sending failed. Please try again.",
};

export function createInbox(deps: InboxDeps) {
  const log = deps.log ?? console;
  const app = new Hono();
  const secret = cookieSecret(deps.password, deps.appSecret);
  const throttle = createLoginThrottle();
  // A second, looser limit across everyone, in case guesses come from many addresses.
  const everyone = createLoginThrottle(30);
  const mainNumber = deps.numbers[0]?.id;

  // Staff pages must never be cached or shown inside another site.
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
  });

  app.get("/login", (c) => c.html(loginPage()));

  app.post("/login", async (c) => {
    const ip = clientIp(c);
    if (throttle.blocked(ip) || everyone.blocked("all")) {
      return c.html(loginPage("Too many wrong passwords. Wait 15 minutes and try again."), 429);
    }
    const form = await c.req.parseBody();
    const attempt = typeof form.password === "string" ? form.password : "";
    if (!passwordMatches(attempt, deps.password)) {
      throttle.failed(ip);
      everyone.failed("all");
      log.warn("Inbox: wrong password");
      return c.html(loginPage("That password isn't right."), 401);
    }
    throttle.succeeded(ip);
    const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    await setSignedCookie(c, COOKIE, String(expires), secret, {
      path: "/inbox",
      httpOnly: true,
      secure: new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https",
      sameSite: "Strict",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return c.redirect("/inbox", 303);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/inbox" });
    return c.redirect("/inbox/login", 303);
  });

  // Everything below needs a valid login cookie.
  app.use("*", async (c, next) => {
    const value = await getSignedCookie(c, secret, COOKIE);
    if (!value || !(Number(value) > Date.now())) return c.redirect("/inbox/login", 303);
    await next();
  });

  app.get("/", async (c) => {
    const chats = await deps.inbox.listChats(CHATS_SHOWN);
    const known = new Set(deps.numbers.map((n) => n.id));
    // Hide chats on numbers this server no longer runs.
    const shown = chats.filter((chat) => chat.businessNumberId === null || known.has(chat.businessNumberId));
    return c.html(
      chatListPage(shown, deps.numbers, (chat) => `/inbox/chat/${chat.contactId}/${chat.businessNumberId ?? mainNumber}`),
    );
  });

  /** Looks up the chat in the URL. Null if the contact or number isn't ours. */
  async function findChat(c: Context) {
    const contactId = c.req.param("contactId") ?? "";
    const numberId = c.req.param("numberId") ?? "";
    const number = deps.numbers.find((n) => n.id === numberId);
    if (!number || !UUID.test(contactId)) return null;
    const contact = await deps.inbox.contact(contactId);
    if (!contact) return null;
    return { contactId, number, contact, base: `/inbox/chat/${contactId}/${number.id}` };
  }

  app.get("/chat/:contactId/:numberId", async (c) => {
    const chat = await findChat(c);
    if (!chat) return c.text("Chat not found", 404);
    const [messages, botPaused, canReply] = await Promise.all([
      deps.inbox.chatMessages(chat.contactId, chat.number.id, chat.number.id === mainNumber, MESSAGES_SHOWN),
      deps.pauses?.isPaused(chat.contactId, chat.number.id),
      canMessageFreely(deps.messages, chat.contact.waId),
    ]);
    return c.html(
      chatPage({
        title: chat.contact.name ? `${chat.contact.name} (+${chat.contact.waId})` : `+${chat.contact.waId}`,
        numberLabel: deps.numbers.length > 1 ? chat.number.label : undefined,
        messages,
        base: chat.base,
        botPaused,
        canReply,
        error: ERRORS[c.req.query("error") ?? ""],
      }),
    );
  });

  app.post("/chat/:contactId/:numberId/reply", async (c) => {
    const chat = await findChat(c);
    if (!chat) return c.text("Chat not found", 404);
    const form = await c.req.parseBody();
    const text = (typeof form.text === "string" ? form.text : "").trim().slice(0, MAX_REPLY);
    if (!text) return c.redirect(`${chat.base}?error=empty`, 303);
    if (!(await canMessageFreely(deps.messages, chat.contact.waId))) return c.redirect(`${chat.base}?error=window`, 303);

    // A person is answering, so the bot steps back from this chat first.
    await deps.pauses?.pause(chat.contactId, chat.number.id);
    try {
      const sent = await deps.whatsapp.sendText(chat.contact.waId, text, chat.number.id);
      await deps.messages.recordOutbound(chat.contactId, {
        waMessageId: sent.waMessageId,
        type: "text",
        body: text,
        // Marks it as a staff reply, so the inbox shows it apart from the bot's.
        raw: { ...(sent.raw as object), inbox: true },
        businessNumberId: chat.number.id,
      });
      log.info(`Inbox: staff replied to ...${chat.contact.waId.slice(-4)}`);
    } catch (err) {
      log.error("Inbox: failed to send a staff reply:", err);
      return c.redirect(`${chat.base}?error=send`, 303);
    }
    return c.redirect(chat.base, 303);
  });

  app.post("/chat/:contactId/:numberId/takeover", async (c) => {
    const chat = await findChat(c);
    if (!chat || !deps.pauses) return c.text("Chat not found", 404);
    await deps.pauses.pause(chat.contactId, chat.number.id);
    return c.redirect(chat.base, 303);
  });

  app.post("/chat/:contactId/:numberId/handback", async (c) => {
    const chat = await findChat(c);
    if (!chat || !deps.pauses) return c.text("Chat not found", 404);
    await deps.pauses.resume(chat.contactId, chat.number.id);
    return c.redirect(chat.base, 303);
  });

  return app;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The visitor's address. Railway puts the real one first in X-Forwarded-For. */
function clientIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

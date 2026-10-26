import type { Hono } from "hono";
import { isPauseActive } from "../../core/db/store.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { canMessageFreely } from "../../core/whatsapp/outbox.js";
import type { SectionContext } from "../index.js";
import { esc, initials } from "../layout.js";
import type { AppContext, Env } from "../types.js";

// The business's own chats: read them, reply as a person, and take a chat over
// from the bot (it stays quiet there until handed back). Only chats on the
// business's own WhatsApp number are shown.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REPLY = 4096;

export function registerInbox(app: Hono<Env>, ctx: SectionContext) {
  const off = (c: AppContext) =>
    ctx.render(c, "Inbox", "/app/inbox", `<p>The inbox isn't switched on yet. Please ask yarnOga support to switch it on.</p>`);

  app.get("/inbox", async (c) => {
    const inbox = ctx.deps.inbox;
    if (!inbox) return off(c);
    const biz = c.get("biz");
    if (biz.features && !(await biz.features.has("staff_inbox"))) {
      return ctx.render(c, "Inbox", "/app/inbox", `<p>The inbox comes with Standard and above. Send <b>plan</b> to your bot on WhatsApp to upgrade.</p>`);
    }
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 60);
    const chats = (await inbox.store.listChats(150, { numberId: biz.numberId, includeUnnumbered: biz.includeUnnumbered })).filter(
      (chat) => !q || (chat.name ?? "").toLowerCase().includes(q) || chat.waId.includes(q.replace(/\D/g, "") || "~"),
    );
    const rows = chats
      .map((chat) => {
        const preview = chat.lastBody ? chat.lastBody.slice(0, 90) : `[${chat.lastType}]`;
        const waiting = chat.lastDirection === "inbound";
        const name = chat.name ?? showWaId(chat.waId);
        return `<a class="chatrow${waiting ? " new" : ""}" href="/app/inbox/${chat.contactId}"><span class="avatar">${esc(initials(name))}</span>
<span class="body"><span class="line1"><b>${esc(name)}</b><span class="muted small">${esc(when(chat.lastAt, ctx.now()))}</span></span>
<span class="preview">${waiting ? '<i class="dot lime"></i>' : "You: "}${esc(preview)}</span></span></a>`;
      })
      .join("");
    return ctx.render(
      c,
      "Inbox",
      "/app/inbox",
      `<form method="get" class="search"><input name="q" value="${esc(q)}" placeholder="Search by name or number" aria-label="Search chats"><button class="ghost">Search</button></form>
<div class="list">${rows || `<p style="padding:14px" class="muted">No chats yet.</p>`}</div>`,
    );
  });

  async function findChat(c: AppContext) {
    const inbox = ctx.deps.inbox;
    const contactId = c.req.param("contactId") ?? "";
    if (!inbox || !UUID.test(contactId)) return null;
    const biz = c.get("biz");
    const [contact, messages] = await Promise.all([
      inbox.store.contact(contactId),
      inbox.store.chatMessages(contactId, biz.numberId, biz.includeUnnumbered, 200),
    ]);
    // Only someone who has written to this business's number.
    if (!contact || !messages.some((m) => m.direction === "inbound")) return null;
    return { inbox, contactId, contact, messages, numberId: biz.numberId, base: `/app/inbox/${contactId}` };
  }

  app.get("/inbox/:contactId", async (c) => {
    const chat = await findChat(c);
    if (!chat) return ctx.render(c, "Chat not found", "/app/inbox", `<p>That chat isn't here. <a href="/app/inbox">Back to the inbox</a></p>`, 404);
    const [pause, canReply] = await Promise.all([
      chat.inbox.messages.botPause(chat.contactId, chat.numberId),
      canMessageFreely(chat.inbox.messages, chat.contact.waId, ctx.now()),
    ]);
    const paused = isPauseActive(pause, ctx.now());
    const bubbles = chat.messages
      .map((m) => {
        const who = m.direction === "inbound" ? "" : m.fromStaff ? "Staff · " : "Bot · ";
        const cls = m.direction === "inbound" ? "" : m.fromStaff ? " out staff" : " out";
        const text = m.body ?? `[${m.type}]`;
        return `<div class="bubble${cls}">${esc(text)}<span class="muted">${who}${esc(when(m.at, ctx.now()))}</span></div>`;
      })
      .join("");
    const title = chat.contact.name ? `${chat.contact.name} (${showWaId(chat.contact.waId)})` : showWaId(chat.contact.waId);
    const control = paused
      ? `<p class="flash good">You're handling this chat${pause?.until ? ` (the bot is back at ${esc(pause.until.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }))})` : ""}. The bot stays quiet here.</p>
<form method="post" action="${chat.base}/handback"><button class="ghost small">Hand back to the bot</button></form>`
      : `<p class="muted">The bot is answering this chat.</p><form method="post" action="${chat.base}/takeover"><button class="ghost small">Take over (bot goes quiet)</button></form>`;
    const reply = canReply
      ? `<form method="post" action="${chat.base}/reply"><label for="t">Reply as a person</label><textarea id="t" name="text" maxlength="${MAX_REPLY}" required></textarea>
<div class="actions"><button>Send</button></div><p class="muted small">Sending a reply takes the chat over from the bot.</p></form>`
      : `<p class="flash bad">The customer last wrote more than a day ago, so WhatsApp won't deliver a reply until they write again.</p>`;
    return ctx.render(c, title, "/app/inbox", `<p><a href="/app/inbox">← All chats</a></p><div class="chat">${bubbles}</div>${control}${reply}`);
  });

  app.post("/inbox/:contactId/reply", async (c) => {
    const chat = await findChat(c);
    if (!chat) return c.text("Chat not found", 404);
    const form = await c.req.parseBody();
    const text = (typeof form.text === "string" ? form.text : "").trim().slice(0, MAX_REPLY);
    if (!text) return c.redirect(`${chat.base}?msg=bad`, 303);
    if (!(await canMessageFreely(chat.inbox.messages, chat.contact.waId, ctx.now()))) return c.redirect(`${chat.base}?msg=window`, 303);
    await chat.inbox.messages.pauseBot(chat.contactId, chat.numberId, null, "inbox");
    try {
      const sent = await chat.inbox.whatsapp.sendText(chat.contact.waId, text, chat.numberId);
      await chat.inbox.messages.recordOutbound(chat.contactId, {
        waMessageId: sent.waMessageId,
        type: "text",
        body: text,
        raw: { ...(sent.raw as object), inbox: true, by: c.get("user").id },
        businessNumberId: chat.numberId,
      });
    } catch (err) {
      ctx.log.error("Owner app: failed to send a reply:", err);
      return c.redirect(`${chat.base}?msg=send`, 303);
    }
    return c.redirect(`${chat.base}?msg=sent`, 303);
  });

  app.post("/inbox/:contactId/takeover", async (c) => {
    const chat = await findChat(c);
    if (!chat) return c.text("Chat not found", 404);
    await chat.inbox.messages.pauseBot(chat.contactId, chat.numberId, null, "inbox");
    return c.redirect(chat.base, 303);
  });

  app.post("/inbox/:contactId/handback", async (c) => {
    const chat = await findChat(c);
    if (!chat) return c.text("Chat not found", 404);
    await chat.inbox.messages.resumeBot(chat.contactId, chat.numberId);
    return c.redirect(chat.base, 303);
  });
}

export function when(d: Date, now: Date): string {
  const minutes = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

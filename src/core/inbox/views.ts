import { html } from "hono/html";
import type { ChatMessage, ChatSummary } from "./store.js";
import { showWaId } from "../whatsapp/ids.js";

// The inbox's web pages, written as plain HTML. Every value placed inside
// html`...` is escaped, so a customer's message can't inject anything into the page.

export interface NumberLabel {
  id: string;
  label: string;
}

const lagosTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Lagos",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function when(date: Date): string {
  return lagosTime.format(date);
}

/** What to show for a message: its text, or what kind of attachment it was. */
function describe(type: string, body: string | null): string {
  if (body) return type === "audio" ? `🎤 ${body}` : body;
  const kinds: Record<string, string> = {
    image: "📷 Photo",
    audio: "🎤 Voice note",
    video: "🎬 Video",
    document: "📄 Document",
    location: "📍 Location",
    sticker: "Sticker",
  };
  return kinds[type] ?? `(${type})`;
}

function page(title: string, body: unknown, opts: { refreshSeconds?: number } = {}) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${opts.refreshSeconds ? html`<meta http-equiv="refresh" content="${opts.refreshSeconds}">` : ""}
<title>${title}</title>
<style>
  :root { --green: #128c4a; --bg: #f4f6f5; --card: #fff; --text: #1b1f1d; --muted: #6b7570; --line: #e1e6e3; --staff: #e8f0ff; --out: #dcf8c6; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); }
  header { background: var(--green); color: #fff; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 17px; margin: 0; flex: 1; }
  header a, header button { color: #fff; background: none; border: 0; font: inherit; cursor: pointer; text-decoration: none; }
  main { max-width: 760px; margin: 0 auto; padding: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
  .chats a { display: block; padding: 12px 14px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
  .chats a:last-child { border-bottom: 0; }
  .chats a:hover { background: #fafcfb; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .name { font-weight: 600; }
  .muted { color: var(--muted); font-size: 13px; }
  .tag { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 99px; background: #eef3f0; color: var(--muted); margin-left: 6px; }
  .preview { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bubbles { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .bubble { max-width: 85%; padding: 8px 12px; border-radius: 10px; white-space: pre-wrap; word-wrap: break-word; }
  .in { align-self: flex-start; background: var(--card); border: 1px solid var(--line); }
  .out { align-self: flex-end; background: var(--out); }
  .out.staff { background: var(--staff); }
  .bubble .muted { display: block; font-size: 11px; margin-top: 2px; }
  .status { padding: 12px 14px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .status.paused { border-color: #f0c36d; background: #fff8e6; }
  form.reply { display: flex; gap: 8px; }
  textarea { flex: 1; font: inherit; padding: 10px; border: 1px solid var(--line); border-radius: 8px; min-height: 48px; resize: vertical; }
  button.primary { background: var(--green); color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer; }
  button.secondary { background: #fff; color: var(--green); border: 1px solid var(--green); border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; }
  .error { background: #fdecea; border: 1px solid #f5c2bd; color: #8a1c12; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; }
  .login { max-width: 360px; margin: 12vh auto; padding: 24px; }
  .login input { width: 100%; font: inherit; padding: 10px; border: 1px solid var(--line); border-radius: 8px; margin: 8px 0 16px; }
  .empty { padding: 24px; text-align: center; color: var(--muted); }
</style>
</head>
<body>${body}</body>
</html>`;
}

function topBar(title: string, back?: string) {
  return html`<header>
  ${back ? html`<a href="${back}" aria-label="Back to all chats">←</a>` : ""}
  <h1>${title}</h1>
  <form method="post" action="/inbox/logout"><button type="submit">Log out</button></form>
</header>`;
}

export function loginPage(error?: string) {
  return page(
    "Inbox login",
    html`<main><div class="card login">
  <h1 style="margin-top:0;font-size:20px">Staff inbox</h1>
  ${error ? html`<div class="error">${error}</div>` : ""}
  <form method="post" action="/inbox/login">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button class="primary" type="submit" style="width:100%">Log in</button>
  </form>
</div></main>`,
  );
}

export function chatListPage(chats: ChatSummary[], numbers: NumberLabel[], chatLink: (chat: ChatSummary) => string) {
  const label = (id: string | null) => numbers.find((n) => n.id === (id ?? numbers[0]?.id))?.label ?? "";
  const items = chats.map(
    (chat) => html`<a href="${chatLink(chat)}">
  <div class="row">
    <span><span class="name">${chat.name || showWaId(chat.waId)}</span>${numbers.length > 1 ? html`<span class="tag">${label(chat.businessNumberId)}</span>` : ""}</span>
    <span class="muted">${when(chat.lastAt)}</span>
  </div>
  <div class="preview">${chat.lastDirection === "outbound" ? "You: " : ""}${describe(chat.lastType, chat.lastBody)}</div>
</a>`,
  );
  return page(
    "Inbox",
    html`${topBar("Inbox")}
<main>
  <div class="card chats">${items.length ? items : html`<div class="empty">No chats yet.</div>`}</div>
  <p class="muted">This page refreshes itself every 30 seconds.</p>
</main>`,
    { refreshSeconds: 30 },
  );
}

export interface ChatPageOptions {
  title: string;
  numberLabel?: string;
  messages: ChatMessage[];
  /** Where the forms post to, e.g. /inbox/chat/<contact>/<number>. */
  base: string;
  botPaused: boolean;
  /** When a temporary pause ends (the owner replied from their phone). Undefined for a take over. */
  pausedUntil?: Date;
  /** False when the customer last wrote over 23 hours ago and WhatsApp won't deliver a normal reply. */
  canReply: boolean;
  error?: string;
}

export function chatPage(o: ChatPageOptions) {
  const bubbles = o.messages.map((m) => {
    const who = m.direction === "inbound" ? "" : m.fromStaff ? "Staff · " : "Bot · ";
    const cls = m.direction === "inbound" ? "in" : m.fromStaff ? "out staff" : "out";
    return html`<div class="bubble ${cls}">${describe(m.type, m.body)}<span class="muted">${who}${when(m.at)}</span></div>`;
  });

  const status = !o.botPaused
    ? html`<div class="card status">
    <span>🤖 The bot is answering this chat.</span>
    <form method="post" action="${o.base}/takeover"><button class="secondary" type="submit">Take over</button></form>
  </div>`
    : o.pausedUntil
      ? html`<div class="card status paused">
    <span>📱 Someone replied from the WhatsApp Business app, so the bot is quiet until ${when(o.pausedUntil)}.</span>
    <span>
      <form method="post" action="${o.base}/takeover" style="display:inline"><button class="secondary" type="submit">Take over</button></form>
      <form method="post" action="${o.base}/handback" style="display:inline"><button class="secondary" type="submit">Hand back now</button></form>
    </span>
  </div>`
      : html`<div class="card status paused">
    <span>🙋 <b>You're handling this chat.</b> The bot stays quiet until you hand it back.</span>
    <form method="post" action="${o.base}/handback"><button class="secondary" type="submit">Hand back to bot</button></form>
  </div>`;

  const replyBox = o.canReply
    ? html`<form class="reply" method="post" action="${o.base}/reply">
    <textarea name="text" placeholder="Type a reply…" required maxlength="4096"></textarea>
    <button class="primary" type="submit">Send</button>
  </form>
  ${o.botPaused && !o.pausedUntil ? "" : html`<p class="muted">Sending a reply takes the chat over from the bot.</p>`}`
    : html`<p class="muted">This customer last wrote more than a day ago. WhatsApp only delivers ordinary replies within 24 hours of their last message, so you can reply once they write again.</p>`;

  return page(
    o.title,
    html`${topBar(o.title, "/inbox")}
<main>
  ${o.numberLabel ? html`<p class="muted" style="margin-top:0">On the ${o.numberLabel} number</p>` : ""}
  ${o.error ? html`<div class="error">${o.error}</div>` : ""}
  ${status}
  <div class="bubbles">${bubbles.length ? bubbles : html`<div class="empty">No messages yet.</div>`}</div>
  ${replyBox}
</main>
<script>
  // Check for new messages every 20 seconds, unless a reply is being typed.
  setInterval(function () {
    var box = document.querySelector("textarea");
    if (!box || !box.value) location.reload();
  }, 20000);
  window.scrollTo(0, document.body.scrollHeight);
</script>`,
  );
}
